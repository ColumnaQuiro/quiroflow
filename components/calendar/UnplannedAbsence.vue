<script setup lang="ts">
import { formatPhoneDisplay } from '~/utils/phone'

// "Ausencia imprevista": a practitioner is off (ill, an emergency) for a day
// or a few, and every visit they had has to go somewhere -- in one go rather
// than visit by visit. Opened from the Calendar's toolbar.
//
//   1. Who and which days. Their booked visits in that range are listed.
//   2. Either move them to a colleague -- each one only if that colleague is
//      free then (no visit, no block); the rest stay as they were and are
//      listed -- or cancel them, the way the Calendar's cancel step does
//      (status only if not already cancelled, then the clinic's
//      appointment.cancelled automations, which tell the patient). No fee,
//      and nothing is offered to the waitlist: the slots are not free, the
//      practitioner is away.
//   3. Their calendar is blocked for those days first ("Ausencia imprevista"),
//      so online booking and the waitlist do not hand the same hours out.
//
// What was done is listed at the end, with a phone number beside each
// cancelled visit for anyone the automations will not reach.
const emit = defineEmits<{ close: []; done: [] }>()
// Opened from an approved leave request (the Turnos tab): who and which days
// are already known, and the calendar is already blocked for them
// (decide_staff_absence), so it is not blocked twice.
const props = defineProps<{ prefill?: { who: string; from: string; to: string; alreadyBlocked?: boolean } | null }>()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()

interface Member { id: string; full_name: string }
interface Visit { id: string; starts_at: string; ends_at: string; clinic_id: string; patient_id: string | null; patients: { first_name: string; last_name: string | null } | null; appointment_types: { name: string } | null }

const today = new Date()
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const practitioners = ref<Member[]>([])
const who = ref(props.prefill?.who ?? '')
const from = ref(props.prefill?.from ?? iso(today))
const to = ref(props.prefill?.to ?? iso(today))
const visits = ref<Visit[] | null>(null)
const picked = ref<Set<string>>(new Set())
const action = ref<'move' | 'cancel'>('move')
const substitute = ref('')
const busy = ref(false)
const error = ref('')
const notifiesOnCancel = ref<boolean | null>(null)
const result = ref<{ moved: Visit[]; cancelled: Visit[]; kept: { visit: Visit; why: string }[]; phones: Map<string, string> } | null>(null)

onMounted(async () => {
  const [{ data: team }, { count }] = await Promise.all([
    supabase.from('team_members').select('id, full_name').eq('is_practitioner', true).is('deleted_at', null).order('full_name'),
    supabase.from('automation_rules').select('id', { count: 'exact', head: true }).eq('trigger_event', 'appointment.cancelled').eq('enabled', true),
  ])
  practitioners.value = (team as Member[] | null) ?? []
  notifiesOnCancel.value = (count ?? 0) > 0
  if (props.prefill) await load()
})

// The days, from local midnight to the midnight after the last, as the
// Calendar's own "whole day" block reads them.
const range = computed(() => {
  const start = new Date(`${from.value}T00:00`)
  const end = new Date(`${to.value}T00:00`)
  end.setDate(end.getDate() + 1)
  return { start, end }
})

async function load() {
  error.value = ''
  result.value = null
  if (!who.value || !from.value || !to.value || to.value < from.value) return
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, ends_at, clinic_id, patient_id, patients(first_name, last_name), appointment_types(name)')
    .eq('practitioner_id', who.value)
    .eq('status', 'booked')
    .is('deleted_at', null)
    // A place in a group class keeps its class's time and practitioner (the
    // appointments_class_place trigger): the class is handled from its own
    // panel, not moved place by place.
    .is('class_session_id', null)
    .gte('starts_at', range.value.start.toISOString())
    .lt('starts_at', range.value.end.toISOString())
    .order('starts_at')
  visits.value = (data as unknown as Visit[] | null) ?? []
  picked.value = new Set(visits.value.map((v) => v.id))
}
watch([who, from, to], load)

const colleagues = computed(() => practitioners.value.filter((p) => p.id !== who.value))
const chosen = computed(() => (visits.value ?? []).filter((v) => picked.value.has(v.id)))
function toggle(id: string, on: boolean) {
  const next = new Set(picked.value)
  if (on) next.add(id)
  else next.delete(id)
  picked.value = next
}

const name = (v: Visit) => [v.patients?.first_name, v.patients?.last_name].filter(Boolean).join(' ')
const when = (iso: string) => new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

async function apply() {
  if (!chosen.value.length || (action.value === 'move' && !substitute.value)) return
  busy.value = true
  error.value = ''
  const absent = practitioners.value.find((p) => p.id === who.value)
  // 1. Block their calendar for the days, in every clinic they had visits in
  //    (and the one on screen), before anything is freed.
  const clinicIds = [...new Set([...(visits.value ?? []).map((v) => v.clinic_id), store.currentClinicId].filter(Boolean) as string[])]
  const { error: blockError } = props.prefill?.alreadyBlocked ? { error: null } : await supabase.from('availability_blocks').insert(
    clinicIds.map((clinicId) => ({
      account_id: store.accountId!,
      clinic_id: clinicId,
      practitioner_id: who.value,
      room_id: null,
      starts_at: range.value.start.toISOString(),
      ends_at: range.value.end.toISOString(),
      note: t(`Unplanned absence${absent ? ` · ${absent.full_name}` : ''}`, `Ausencia imprevista${absent ? ` · ${absent.full_name}` : ''}`),
      created_by: store.teamMember?.id,
    })) as never,
  )
  if (blockError) {
    busy.value = false
    error.value = blockError.message
    return
  }

  const moved: Visit[] = []
  const cancelled: Visit[] = []
  const kept: { visit: Visit; why: string }[] = []
  if (action.value === 'move') {
    // The colleague's own visits and blocks across the range, read once.
    const [{ data: theirs }, { data: blocks }] = await Promise.all([
      supabase.from('appointments').select('starts_at, ends_at').eq('practitioner_id', substitute.value).neq('status', 'cancelled').is('deleted_at', null).lt('starts_at', range.value.end.toISOString()).gt('ends_at', range.value.start.toISOString()),
      supabase.from('availability_blocks').select('starts_at, ends_at, practitioner_id').or(`practitioner_id.eq.${substitute.value},practitioner_id.is.null`).lt('starts_at', range.value.end.toISOString()).gt('ends_at', range.value.start.toISOString()),
    ])
    const busySlots = [...((theirs as { starts_at: string; ends_at: string }[] | null) ?? []), ...((blocks as { starts_at: string; ends_at: string }[] | null) ?? [])]
    for (const v of chosen.value) {
      const clash = busySlots.some((b) => b.starts_at < v.ends_at && b.ends_at > v.starts_at)
      if (clash) {
        kept.push({ visit: v, why: t('the colleague is busy then', 'el compañero está ocupado a esa hora') })
        continue
      }
      const { data: changed } = await supabase.from('appointments').update({ practitioner_id: substitute.value }).eq('id', v.id).eq('practitioner_id', who.value).eq('status', 'booked').select('id')
      if ((changed ?? []).length) {
        moved.push(v)
        busySlots.push({ starts_at: v.starts_at, ends_at: v.ends_at })
      } else kept.push({ visit: v, why: t('it changed meanwhile', 'cambió mientras tanto') })
    }
  } else {
    for (const v of chosen.value) {
      const { data: changed } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', v.id).neq('status', 'cancelled').select('id')
      if ((changed ?? []).length) {
        cancelled.push(v)
        if (v.patient_id) fire('appointment.cancelled', { patientId: v.patient_id, appointmentId: v.id })
      } else kept.push({ visit: v, why: t('it was already cancelled', 'ya estaba cancelada') })
    }
  }

  // A number to ring for each cancelled visit, as the patient record's Call takes it.
  const phones = new Map<string, string>()
  const ids = [...new Set(cancelled.map((v) => v.patient_id).filter(Boolean) as string[])]
  if (ids.length) {
    const { data: nums } = await supabase.from('patient_contact_numbers').select('patient_id, number, country_code').in('patient_id', ids).order('created_at')
    for (const n of (nums as { patient_id: string; number: string; country_code: string }[] | null) ?? []) if (!phones.has(n.patient_id)) phones.set(n.patient_id, formatPhoneDisplay(n.number, n.country_code))
  }
  result.value = { moved, cancelled, kept, phones }
  busy.value = false
  emit('done')
}

const field = 'mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/30 p-4" @click.self="emit('close')">
    <div class="max-h-full w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-popover" role="dialog" aria-modal="true" aria-labelledby="absence-title" data-cy="absence">
      <div class="flex items-center justify-between">
        <h2 id="absence-title" class="text-[16px] font-[640] text-ink-900">{{ t('Unplanned absence', 'Ausencia imprevista') }}</h2>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="-m-2 p-2 text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>

      <template v-if="!result">
        <p class="mt-1 text-[12.5px] text-ink-muted">{{ t('Their calendar is blocked for those days, and their visits are moved to a colleague or cancelled, all at once.', 'Se bloquea su agenda esos días, y sus citas pasan a un compañero o se cancelan, todas a la vez.') }}</p>
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="text-[12.5px] font-medium text-ink-600 sm:col-span-3">{{ t('Who is away', 'Quién falta') }}
            <select v-model="who" :class="field" data-cy="absence-who">
              <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
              <option v-for="p in practitioners" :key="p.id" :value="p.id">{{ p.full_name }}</option>
            </select>
          </label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('From', 'Desde') }}<input v-model="from" type="date" :class="field" data-cy="absence-from" /></label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('To', 'Hasta') }}<input v-model="to" type="date" :min="from" :class="field" data-cy="absence-to" /></label>
        </div>

        <template v-if="visits">
          <p v-if="!visits.length" class="mt-4 text-[13px] text-ink-muted" data-cy="absence-none">{{ t('No booked visits in those days. Their calendar can still be blocked from "Block time".', 'No tiene citas reservadas esos días. Su agenda se puede bloquear igualmente desde «Bloquear horario».') }}</p>
          <template v-else>
            <p class="mt-4 text-[12.5px] font-semibold text-ink-700">{{ t(`${visits.length} visits`, `${visits.length} citas`) }}</p>
            <ul class="mt-1.5 max-h-56 divide-y divide-line-divider overflow-y-auto rounded-ctl border border-line-row">
              <li v-for="v in visits" :key="v.id" class="flex items-center gap-2.5 px-3 py-2 text-[13px]" data-cy="absence-visit">
                <input type="checkbox" class="h-4 w-4 accent-brand" :checked="picked.has(v.id)" :aria-label="name(v)" @change="toggle(v.id, ($event.target as HTMLInputElement).checked)" />
                <span class="w-36 shrink-0 text-ink-muted">{{ when(v.starts_at) }}</span>
                <span class="min-w-0 flex-1 truncate text-ink-900">{{ name(v) }}<span class="text-ink-muted"> · {{ v.appointment_types?.name ?? '' }}</span></span>
              </li>
            </ul>

            <fieldset class="mt-4 flex flex-col gap-2">
              <legend class="mb-1 text-[12.5px] font-semibold text-ink-700">{{ t('What to do with them', 'Qué hacer con ellas') }}</legend>
              <label class="flex items-center gap-2 text-[13px] text-ink-700"><input v-model="action" type="radio" value="move" data-cy="absence-action-move" />{{ t('Move to a colleague, where they are free', 'Pasarlas a un compañero, donde esté libre') }}</label>
              <select v-if="action === 'move'" v-model="substitute" :class="[field, 'ml-6 w-auto']" data-cy="absence-substitute">
                <option value="" disabled>{{ t('Choose a colleague…', 'Elige compañero…') }}</option>
                <option v-for="p in colleagues" :key="p.id" :value="p.id">{{ p.full_name }}</option>
              </select>
              <label class="flex items-center gap-2 text-[13px] text-ink-700"><input v-model="action" type="radio" value="cancel" data-cy="absence-action-cancel" />{{ t('Cancel them and let the patients know', 'Cancelarlas y avisar a los pacientes') }}</label>
              <p v-if="action === 'cancel'" class="ml-6 text-[12px]" :class="notifiesOnCancel ? 'text-ink-muted' : 'text-warning-text'" data-cy="absence-notice">
                {{ notifiesOnCancel
                  ? t('Your "appointment cancelled" automations tell them, as when a visit is cancelled from the calendar. No fee is charged.', 'Tus automatizaciones de «cita cancelada» les avisan, como al cancelar desde la agenda. No se cobra nada.')
                  : t('No automation tells patients about a cancellation: you will get their numbers to call them.', 'Ninguna automatización avisa al paciente de una cancelación: tendrás sus teléfonos para llamarles.') }}
              </p>
            </fieldset>
          </template>
        </template>

        <p v-if="error" role="alert" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <UiBtn variant="secondary" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <UiBtn variant="primary" :disabled="busy || !chosen.length || (action === 'move' && !substitute)" data-cy="absence-apply" @click="apply">
            {{ busy ? t('Working…', 'Aplicando…') : action === 'move' ? t(`Block and move ${chosen.length}`, `Bloquear y mover ${chosen.length}`) : t(`Block and cancel ${chosen.length}`, `Bloquear y cancelar ${chosen.length}`) }}
          </UiBtn>
        </div>
      </template>

      <div v-else class="mt-4 flex flex-col gap-3" data-cy="absence-result">
        <p class="text-[13.5px] text-ink-900">
          {{ t('Calendar blocked.', 'Agenda bloqueada.') }}
          <span v-if="result.moved.length" data-cy="absence-moved">{{ t(`${result.moved.length} moved.`, `${result.moved.length} movidas.`) }}</span>
          <span v-if="result.cancelled.length" data-cy="absence-cancelled">{{ t(`${result.cancelled.length} cancelled.`, `${result.cancelled.length} canceladas.`) }}</span>
        </p>
        <div v-if="result.kept.length" class="rounded-ctl bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text" data-cy="absence-kept">
          <p class="font-semibold">{{ t('Left as they were — sort these by hand:', 'Se quedaron como estaban — resuélvelas a mano:') }}</p>
          <p v-for="k in result.kept" :key="k.visit.id">{{ when(k.visit.starts_at) }} · {{ name(k.visit) }} ({{ k.why }})</p>
        </div>
        <div v-if="result.cancelled.length" class="text-[12.5px] text-ink-700">
          <p class="font-semibold">{{ t('Cancelled visits', 'Citas canceladas') }}</p>
          <p v-for="v in result.cancelled" :key="v.id">{{ when(v.starts_at) }} · {{ name(v) }}<span v-if="v.patient_id && result.phones.get(v.patient_id)" class="text-ink-muted"> · {{ result.phones.get(v.patient_id) }}</span></p>
        </div>
        <div class="flex justify-end"><UiBtn variant="primary" @click="emit('close')">{{ t('Done', 'Hecho') }}</UiBtn></div>
      </div>
    </div>
  </div>
</template>
