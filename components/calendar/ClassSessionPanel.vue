<script setup lang="ts">
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'

// One class on the Calendar (class_sessions): who has a place, and their
// attendance in one tap. Design: ClassesCalendar on the QuiroFlow canvas.
//
// Each place is an ordinary appointment, so everything here is what the
// calendar does to a visit -- "Vino" completes it (and fires
// appointment.completed), "No vino" marks it a no-show (appointment.no_show),
// adding someone books one (appointment.booked, and the usual confirmation).
// Charging, a bono session and undoing a visit are the visit's own panel,
// opened from the person's name: a class place is billed like a visit.
const props = defineProps<{ sessionId: string; readOnly?: boolean }>()
const emit = defineEmits<{ close: []; changed: []; openAppointment: [id: string] }>()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()

interface Session {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  cancelled_at: string | null
  clinic_id: string
  practitioner_id: string
  room_id: string | null
  appointment_type_id: string
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
  calendar_resources: { name: string } | null
}
interface Place { id: string; status: string; patient_id: string; patients: { first_name: string; last_name: string | null } | null }
interface Bono { patient_id: string; package_name: string; sessions_used: number; sessions_total: number }
interface Waiting { id: string; status: string; patient_id: string; offer_expires_at: string | null; notes: string | null; patients: { first_name: string; last_name: string | null } | null }

const session = ref<Session | null>(null)
const places = ref<Place[]>([])
const bonos = ref<Map<string, Bono>>(new Map())
// Its waitlist (20261015165454_class_waitlist.sql): joined here or online
// once it is full, and offered a place when one is cancelled.
const waiting = ref<Waiting[]>([])
const busy = ref(false)
const error = ref('')

async function load() {
  const [{ data: s }, { data: ps }, { data: ws }] = await Promise.all([
    supabase.from('class_sessions').select('id, starts_at, ends_at, capacity, cancelled_at, clinic_id, practitioner_id, room_id, appointment_type_id, appointment_types(name), team_members!class_sessions_practitioner_id_fkey(full_name), calendar_resources(name)').eq('id', props.sessionId).maybeSingle(),
    supabase.from('appointments').select('id, status, patient_id, patients(first_name, last_name)').eq('class_session_id', props.sessionId).is('deleted_at', null).neq('status', 'cancelled').order('created_at'),
    supabase.from('waitlist_entries').select('id, status, patient_id, offer_expires_at, notes, patients(first_name, last_name)').eq('class_session_id', props.sessionId).in('status', ['waiting', 'offered']).order('created_at'),
  ])
  waiting.value = (ws as unknown as Waiting[] | null) ?? []
  session.value = (s as unknown as Session | null) ?? null
  places.value = (ps as unknown as Place[] | null) ?? []
  const ids = places.value.map((p) => p.patient_id)
  if (ids.length) {
    const { data: bs } = await supabase.from('package_purchases').select('patient_id, package_name, sessions_used, sessions_total').in('patient_id', ids).eq('is_closed', false).order('created_at', { ascending: false })
    const map = new Map<string, Bono>()
    for (const b of (bs as Bono[] | null) ?? []) if (b.sessions_used < b.sessions_total && !map.has(b.patient_id)) map.set(b.patient_id, b)
    bonos.value = map
  }
}
onMounted(load)
watch(() => props.sessionId, load)

const name = (p: Place) => [p.patients?.first_name, p.patients?.last_name].filter(Boolean).join(' ')
const when = computed(() => {
  const s = session.value
  if (!s) return ''
  const start = new Date(s.starts_at)
  const end = new Date(s.ends_at)
  const hm = (d: Date) => d.toLocaleTimeString(t('en-GB', 'es-ES'), { hour: '2-digit', minute: '2-digit' })
  return `${start.toLocaleDateString(t('en-GB', 'es-ES'), { weekday: 'long', day: 'numeric', month: 'short' })} · ${hm(start)}–${hm(end)}`
})
const placesLeft = computed(() => Math.max(0, (session.value?.capacity ?? 0) - places.value.length))
const isPast = computed(() => !!session.value && new Date(session.value.starts_at).getTime() <= Date.now())
const pending = computed(() => places.value.filter((p) => p.status === 'booked'))

async function setStatus(p: Place, status: 'completed' | 'no_show') {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.from('appointments').update({ status }).eq('id', p.id)
  busy.value = false
  if (e) {
    error.value = e.message
    return
  }
  fire(status === 'completed' ? 'appointment.completed' : 'appointment.no_show', { patientId: p.patient_id, appointmentId: p.id })
  p.status = status
  emit('changed')
}
async function allOthersCame() {
  for (const p of [...pending.value]) await setStatus(p, 'completed')
}

// ---- adding someone
const query = ref('')
const results = ref<{ id: string; first_name: string; last_name: string | null }[]>([])
let token = 0
let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(debounce)
  const mine = ++token
  const term = sanitizeSearchToken(q.trim())
  if (!term) {
    results.value = []
    return
  }
  debounce = setTimeout(async () => {
    const { data } = await supabase.from('patients').select('id, first_name, last_name').ilike('search_name', `%${normalizeSearchTerm(term)}%`).order('first_name').limit(8)
    if (mine === token) results.value = data ?? []
  }, 250)
})
async function add(patientId: string) {
  const s = session.value
  if (!s) return
  if (placesLeft.value === 0) return addToWaitlist(patientId)
  busy.value = true
  error.value = ''
  // The trigger gives the place the session's time, practitioner and room,
  // and refuses it when the class is full.
  const { data, error: e } = await supabase
    .from('appointments')
    .insert({ account_id: store.accountId!, clinic_id: s.clinic_id, patient_id: patientId, appointment_type_id: s.appointment_type_id, practitioner_id: s.practitioner_id, room_id: s.room_id, starts_at: s.starts_at, ends_at: s.ends_at, status: 'booked', source: 'staff', class_session_id: s.id })
    .select('id')
    .single()
  busy.value = false
  if (e || !data) {
    error.value = e?.code === '23505' ? t('They already have a place in this class.', 'Ya tiene plaza en esta clase.') : (e?.message ?? '')
    return
  }
  fire('appointment.booked', { patientId, appointmentId: data.id })
  useStaffFetch('/api/appointments/send-confirmation', { method: 'POST', body: { appointmentId: data.id } }).catch(() => {})
  query.value = ''
  results.value = []
  await load()
  emit('changed')
}

// ---- the waitlist
const waitingName = (w: Waiting) => [w.patients?.first_name, w.patients?.last_name].filter(Boolean).join(' ')
async function addToWaitlist(patientId: string) {
  const s = session.value
  if (!s) return
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.from('waitlist_entries').insert({ account_id: store.accountId!, clinic_id: s.clinic_id, patient_id: patientId, appointment_type_id: s.appointment_type_id, practitioner_id: s.practitioner_id, status: 'waiting', source: 'staff', class_session_id: s.id, created_by: store.teamMember?.id ?? null })
  busy.value = false
  if (e) {
    error.value = e.code === '23505' ? t('They are already waiting for this class.', 'Ya está en la lista de espera de esta clase.') : e.message
    return
  }
  query.value = ''
  results.value = []
  await load()
}
// The desk spoke to them: the place is theirs now, no link to claim.
async function givePlace(w: Waiting) {
  const s = session.value
  if (!s) return
  busy.value = true
  error.value = ''
  const { data, error: e } = await supabase
    .from('appointments')
    .insert({ account_id: store.accountId!, clinic_id: s.clinic_id, patient_id: w.patient_id, appointment_type_id: s.appointment_type_id, practitioner_id: s.practitioner_id, room_id: s.room_id, starts_at: s.starts_at, ends_at: s.ends_at, status: 'booked', source: 'waitlist', class_session_id: s.id })
    .select('id')
    .single()
  if (e || !data) {
    busy.value = false
    error.value = e?.message ?? ''
    return
  }
  await supabase.from('waitlist_entries').update({ status: 'booked', booked_appointment_id: data.id, claim_token: null }).eq('id', w.id)
  busy.value = false
  fire('appointment.booked', { patientId: w.patient_id, appointmentId: data.id })
  useStaffFetch('/api/appointments/send-confirmation', { method: 'POST', body: { appointmentId: data.id } }).catch(() => {})
  await load()
  emit('changed')
}
async function removeWaiting(w: Waiting) {
  const { error: e } = await supabase.from('waitlist_entries').update({ status: 'cancelled', claim_token: null }).eq('id', w.id)
  if (e) error.value = e.message
  await load()
}
const offeredUntil = (w: Waiting) => (w.offer_expires_at ? new Date(w.offer_expires_at).toLocaleTimeString(t('en-GB', 'es-ES'), { hour: '2-digit', minute: '2-digit' }) : '')

// ---- cancelling the whole class
const confirmCancel = ref(false)
async function cancelClass() {
  const s = session.value
  if (!s) return
  busy.value = true
  error.value = ''
  for (const p of places.value.filter((x) => x.status === 'booked')) {
    const { error: e } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', p.id)
    if (e) {
      error.value = e.message
      busy.value = false
      return
    }
    fire('appointment.cancelled', { patientId: p.patient_id, appointmentId: p.id })
  }
  const { error: e } = await supabase.from('class_sessions').update({ cancelled_at: new Date().toISOString() }).eq('id', s.id)
  busy.value = false
  if (e) {
    error.value = e.message
    return
  }
  emit('changed')
  emit('close')
}

const toggle = 'h-[30px] rounded-ctl border px-2.5 text-[12px] font-semibold disabled:opacity-50'
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-ink-900/20" @click.self="emit('close')">
    <aside class="flex h-full w-full max-w-[420px] flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-5 shadow-popover" role="dialog" aria-modal="true" aria-labelledby="class-title" data-cy="class-panel">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-[12px] text-ink-muted">{{ t('Class', 'Clase') }}</p>
          <h2 id="class-title" class="mt-0.5 text-[18px] font-bold text-ink-900">{{ session?.appointment_types?.name }}</h2>
          <p class="mt-0.5 text-[12.5px] capitalize text-ink-muted">{{ when }}</p>
          <p class="text-[12.5px] text-ink-muted">{{ session?.team_members?.full_name }}<template v-if="session?.calendar_resources"> · {{ session.calendar_resources.name }}</template></p>
        </div>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="-m-2 p-2 text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>

      <p v-if="session?.cancelled_at" class="rounded-ctl bg-danger-bg px-3 py-2 text-[13px] text-danger-text">{{ t('This class was cancelled.', 'Esta clase se canceló.') }}</p>
      <div class="flex flex-wrap gap-2">
        <span class="inline-flex h-[22px] items-center rounded-pill bg-brand-tint px-2 text-[11.5px] font-semibold text-brand-text" data-cy="class-places">
          {{ t(`${places.length} of ${session?.capacity ?? 0} places`, `${places.length} de ${session?.capacity ?? 0} plazas`) }}
        </span>
        <span v-if="placesLeft === 0" class="inline-flex h-[22px] items-center rounded-pill bg-warning-bg px-2 text-[11.5px] font-semibold text-warning-text">{{ t('Full', 'Completa') }}</span>
      </div>

      <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>

      <div>
        <p v-if="!places.length" class="py-2 text-[13px] text-ink-muted">{{ t('Nobody has a place yet.', 'Todavía no hay nadie apuntado.') }}</p>
        <div v-for="p in places" :key="p.id" class="flex items-center gap-2.5 border-b border-line-divider py-2" data-cy="class-place" :data-name="name(p)" :data-status="p.status">
          <button type="button" class="min-w-0 flex-1 truncate text-left text-[13.5px] text-ink-900 hover:underline" data-cy="class-place-open" @click="emit('openAppointment', p.id)">
            {{ name(p) }}
            <span class="text-[12px] text-ink-muted">
              <template v-if="bonos.get(p.patient_id)"> · {{ t('bono', 'bono') }} {{ bonos.get(p.patient_id)!.sessions_used }}/{{ bonos.get(p.patient_id)!.sessions_total }}</template>
            </span>
          </button>
          <template v-if="!readOnly && !session?.cancelled_at">
            <button
              type="button"
              :class="[toggle, p.status === 'completed' ? 'border-success-border bg-success-bg text-success-text' : 'border-line-control bg-surface text-ink-500']"
              :aria-pressed="p.status === 'completed'"
              :disabled="busy || p.status !== 'booked'"
              data-cy="class-came"
              @click="setStatus(p, 'completed')"
            >{{ t('Came', 'Vino') }}</button>
            <button
              type="button"
              :class="[toggle, p.status === 'no_show' ? 'border-danger-border bg-danger-bg text-danger-text' : 'border-line-control bg-surface text-ink-500']"
              :aria-pressed="p.status === 'no_show'"
              :disabled="busy || p.status !== 'booked'"
              data-cy="class-missed"
              @click="setStatus(p, 'no_show')"
            >{{ t("Didn't come", 'No vino') }}</button>
          </template>
        </div>
      </div>

      <template v-if="!readOnly && !session?.cancelled_at">
        <UiBtn v-if="isPast && pending.length" variant="primary" :disabled="busy" data-cy="class-all-came" @click="allOthersCame">
          {{ places.length === pending.length ? t('Everyone came', 'Vinieron todos') : t('Everyone else came', 'Todos los demás vinieron') }}
        </UiBtn>

        <div class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
          <label class="text-[12.5px] font-medium text-ink-600" for="class-add">{{ placesLeft > 0 ? t('Add to the class', 'Añadir a la clase') : t('Add to the waitlist', 'Añadir a la lista de espera') }}</label>
          <input id="class-add" v-model="query" type="search" :placeholder="t('Search patient', 'Buscar paciente')" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900" data-cy="class-add-search" />
          <button v-for="r in results" :key="r.id" type="button" class="rounded-ctl px-2.5 py-1.5 text-left text-[13px] text-ink-900 hover:bg-surface-subtle" :disabled="busy" data-cy="class-add-result" @click="add(r.id)">
            {{ r.first_name }} {{ r.last_name ?? '' }}
          </button>
        </div>

        <div v-if="waiting.length" class="flex flex-col border-t border-line-divider pt-3" data-cy="class-waitlist">
          <p class="text-[12.5px] font-semibold text-ink-700">{{ t('Waitlist', 'Lista de espera') }} · {{ waiting.length }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('When a place is cancelled it is offered to them in this order, with a link to take it.', 'Si se cancela una plaza, se les ofrece por este orden, con un enlace para quedársela.') }}</p>
          <div v-for="(w, i) in waiting" :key="w.id" class="flex items-center gap-2 border-b border-line-divider py-2 text-[13px]" data-cy="class-waiting" :data-name="waitingName(w)" :data-status="w.status">
            <span class="w-5 text-ink-muted">{{ i + 1 }}.</span>
            <span class="min-w-0 flex-1 truncate text-ink-900">{{ waitingName(w) }}
              <span v-if="w.status === 'offered'" class="text-[12px] text-warning-text"> · {{ t('offered until', 'ofrecida hasta las') }} {{ offeredUntil(w) }}</span>
            </span>
            <UiBtn v-if="placesLeft > 0" size="sm" :disabled="busy" data-cy="class-waiting-give" @click="givePlace(w)">{{ t('Give the place', 'Dar la plaza') }}</UiBtn>
            <UiBtn size="sm" variant="ghost" data-cy="class-waiting-remove" @click="removeWaiting(w)">{{ t('Remove', 'Quitar') }}</UiBtn>
          </div>
        </div>

        <p class="text-[12px] text-ink-muted">{{ t('Tap a name to charge the visit, draw it from a bono or undo it.', 'Toca un nombre para cobrar la visita, descontarla de un bono o deshacerla.') }}</p>

        <div class="mt-auto border-t border-line-divider pt-3">
          <UiBtn v-if="!confirmCancel" variant="ghost" size="sm" data-cy="class-cancel" @click="confirmCancel = true">{{ t('Cancel this class', 'Cancelar esta clase') }}</UiBtn>
          <div v-else class="flex flex-col gap-2">
            <p class="text-[12.5px] text-ink-700">{{ t('Every place is cancelled, and the clinic\'s cancellation automations tell each patient.', 'Se cancelan todas las plazas, y las automatizaciones de cancelación de la clínica avisan a cada paciente.') }}</p>
            <div class="flex gap-2">
              <UiBtn size="sm" @click="confirmCancel = false">{{ t('Keep it', 'Mantenerla') }}</UiBtn>
              <UiBtn size="sm" variant="primary" :disabled="busy" data-cy="class-cancel-confirm" @click="cancelClass">{{ t('Cancel the class', 'Cancelar la clase') }}</UiBtn>
            </div>
          </div>
        </div>
      </template>
    </aside>
  </div>
</template>
