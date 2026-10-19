<script setup lang="ts">
import { clinicDateOf, nextDate, startOfLocalDate } from '~/utils/clinicClock'
import { absenceKindLabel, isOpenEndedAbsence, OPEN_ENDED_ABSENCE } from '~/utils/staffShifts'

// "Ausencia" on a team member's page: pausing someone who is still on the
// team -- a baja, an illness, maternity or paternity -- without deactivating
// them. An owner records it here (record_staff_absence), with a return date
// or "hasta nuevo aviso", and it is an approved staff absence like any other
// (20261019085552_pause_a_team_member.sql): their calendar is blocked for
// those days, so online booking, the waitlist and the AI receptionist offer
// none of their time, and the receptionist offers their patients a colleague.
// "Ha vuelto" or a new return date moves the end (set_staff_absence_return).
//
// Their visits already booked inside it are not touched here: the count is
// shown, and "Mover o cancelar sus citas" opens the calendar's Ausencia
// imprevista with the days filled in.
const props = defineProps<{ memberId: string; name: string; isPractitioner: boolean }>()
const emit = defineEmits<{ changed: [current: { kind: string; endsOn: string } | null] }>()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { showToast } = useToast()
const { timeZone } = useAccountTimeZone()

interface Absence { id: string; kind: string; starts_on: string; ends_on: string; note: string | null }
const today = computed(() => clinicDateOf(new Date(), timeZone.value))
const absences = ref<Absence[]>([])
const loaded = ref(false)
const current = computed(() => absences.value.find((a) => a.starts_on <= today.value) ?? null)

async function load() {
  const { data } = await supabase
    .from('staff_absences')
    .select('id, kind, starts_on, ends_on, note')
    .eq('team_member_id', props.memberId)
    .eq('status', 'approved')
    .eq('half_day', false)
    .gte('ends_on', today.value)
    .order('starts_on')
  absences.value = (data as Absence[] | null) ?? []
  loaded.value = true
  emit('changed', current.value ? { kind: current.value.kind, endsOn: current.value.ends_on } : null)
}
onMounted(load)

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
function span(a: Absence) {
  const from = a.starts_on <= today.value ? t(`since ${fmt(a.starts_on)}`, `desde el ${fmt(a.starts_on)}`) : t(`from ${fmt(a.starts_on)}`, `a partir del ${fmt(a.starts_on)}`)
  if (isOpenEndedAbsence(a.ends_on)) return `${from} · ${t('no return date yet', 'sin fecha de vuelta')}`
  return `${from} · ${t(`back ${fmt(nextDate(a.ends_on))}`, `vuelve el ${fmt(nextDate(a.ends_on))}`)}`
}

// Visits still booked with them inside an absence: they are not moved by
// recording it, so the owner is told and offered the calendar's tool.
const bookedInside = ref<Record<string, number>>({})
watch(absences, async (list) => {
  const counts: Record<string, number> = {}
  await Promise.all(
    list.map(async (a) => {
      const from = a.starts_on > today.value ? a.starts_on : today.value
      const { count } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('practitioner_id', props.memberId)
        .is('deleted_at', null)
        .not('status', 'in', '(cancelled,no_show)')
        .gte('starts_at', startOfLocalDate(from, timeZone.value).toISOString())
        .lt('starts_at', startOfLocalDate(nextDate(a.ends_on), timeZone.value).toISOString())
      counts[a.id] = count ?? 0
    }),
  )
  bookedInside.value = counts
})
const moving = ref<Absence | null>(null)

// --- Recording one --------------------------------------------------------------------------
const KINDS = ['sick', 'parental', 'personal', 'vacation', 'training'] as const
const adding = ref(false)
const form = reactive({ kind: 'sick' as string, from: '', returns: '', note: '' })
const saving = ref(false)
function startAdding() {
  Object.assign(form, { kind: 'sick', from: today.value, returns: '', note: '' })
  adding.value = true
}
const formProblem = computed(() => {
  if (!form.from) return t('Choose the first day.', 'Elige el primer día.')
  if (form.returns && form.returns <= form.from) return t('They are back after the first day.', 'La vuelta tiene que ser después del primer día.')
  if (form.kind === 'vacation' && !form.returns) return t('Holidays need the day they are back.', 'Las vacaciones necesitan el día de vuelta.')
  return ''
})
async function record() {
  if (formProblem.value) return
  saving.value = true
  const { error } = await supabase.rpc('record_staff_absence', {
    p_team_member_id: props.memberId,
    p_kind: form.kind,
    p_starts_on: form.from,
    p_returns_on: form.returns || null,
    p_note: form.note.trim() || null,
  })
  saving.value = false
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  adding.value = false
  showToast(t(`${props.name} is away.`, `${props.name} queda en ausencia.`))
  await load()
}

// --- Return date ------------------------------------------------------------------------------
const changingReturn = ref<Absence | null>(null)
const newReturn = ref('')
const returnBusy = ref(false)
async function setReturn(a: Absence, returnsOn: string) {
  returnBusy.value = true
  const { error } = await supabase.rpc('set_staff_absence_return', { p_absence_id: a.id, p_returns_on: returnsOn })
  returnBusy.value = false
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  changingReturn.value = null
  showToast(returnsOn <= today.value ? t(`${props.name} is back.`, `${props.name} ha vuelto.`) : t('Return date saved.', 'Fecha de vuelta guardada.'))
  await load()
}
function openReturn(a: Absence) {
  newReturn.value = isOpenEndedAbsence(a.ends_on) ? '' : nextDate(a.ends_on)
  changingReturn.value = a
}

const button = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-50'
const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex flex-col gap-3" data-cy="member-absence" :data-ready="loaded ? 'true' : undefined">
    <p class="text-[13.5px] leading-snug text-ink-500">
      {{
        isPractitioner
          ? t('For a sick leave, maternity or paternity: they stay on the team, but while they are away nobody is offered their time — not online booking, not the waitlist, not the AI receptionist, which offers their patients a colleague instead.', 'Para una baja, maternidad o paternidad: sigue en el equipo, pero mientras esté fuera no se ofrecen sus horas — ni en la reserva online, ni en la lista de espera, ni la recepcionista IA, que a sus pacientes les ofrece otra compañera.')
          : t('For a sick leave, maternity or paternity: they stay on the team, and the days show as an absence on the Turnos tab.', 'Para una baja, maternidad o paternidad: sigue en el equipo, y los días aparecen como ausencia en la pestaña Turnos.')
      }}
    </p>

    <div v-for="a in absences" :key="a.id" class="flex flex-col gap-2 rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3" data-cy="member-absence-row">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[14px] font-bold text-warning-text">{{ absenceKindLabel(a.kind, t) }}</span>
        <span class="text-[13.5px] text-ink-700" data-cy="member-absence-span">{{ span(a) }}</span>
      </div>
      <p v-if="a.note" class="text-[13px] text-ink-500">{{ a.note }}</p>
      <p v-if="isPractitioner && bookedInside[a.id]" class="text-[13px] text-ink-700" data-cy="member-absence-booked">
        {{ t(`${bookedInside[a.id]} visits are still booked with them in these days.`, `Aún tiene ${bookedInside[a.id]} citas en estos días.`) }}
        <button type="button" class="font-semibold text-brand-text hover:underline" data-cy="member-absence-move" @click="moving = a">{{ t('Move or cancel them', 'Mover o cancelar sus citas') }}</button>
      </p>
      <div v-if="store.isOwner" class="flex flex-wrap gap-2">
        <button v-if="a.starts_on <= today" type="button" :class="button" :disabled="returnBusy" data-cy="member-absence-back" @click="setReturn(a, today)">{{ t('Back today', 'Ha vuelto hoy') }}</button>
        <button type="button" :class="button" data-cy="member-absence-return" @click="openReturn(a)">{{ isOpenEndedAbsence(a.ends_on) ? t('Set return date', 'Poner fecha de vuelta') : t('Change return date', 'Cambiar fecha de vuelta') }}</button>
        <button v-if="a.starts_on > today" type="button" :class="button" :disabled="returnBusy" data-cy="member-absence-remove" @click="setReturn(a, a.starts_on)">{{ t('Remove', 'Quitar') }}</button>
      </div>
    </div>

    <template v-if="store.isOwner">
      <button v-if="!adding" type="button" :class="[button, 'self-start']" data-cy="member-absence-add" @click="startAdding">{{ t(`Mark ${name} as away`, `Poner a ${name} en ausencia`) }}</button>
      <form v-else class="flex flex-col gap-3 rounded-ctl border border-line p-4" data-cy="member-absence-form" @submit.prevent="record">
        <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Type', 'Tipo')">
          <button
            v-for="k in KINDS"
            :key="k"
            type="button"
            class="h-9 touch:h-11 rounded-pill border px-3 text-[13px] font-semibold"
            :class="form.kind === k ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
            :aria-pressed="form.kind === k"
            :data-cy="`member-absence-kind-${k}`"
            @click="form.kind = k"
          >
            {{ absenceKindLabel(k, t) }}
          </button>
        </div>
        <div class="flex flex-wrap gap-3">
          <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
            {{ t('From', 'Desde') }}
            <input v-model="form.from" type="date" :class="inputClass" data-cy="member-absence-from" />
          </label>
          <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
            {{ t('Back on (optional)', 'Vuelve el (opcional)') }}
            <input v-model="form.returns" type="date" :min="form.from || undefined" :class="inputClass" data-cy="member-absence-returns" />
          </label>
        </div>
        <span class="text-[12.5px] text-ink-muted">{{ form.returns ? t('The pause ends by itself that morning.', 'La ausencia termina sola esa mañana.') : t('Without a date it lasts until you mark them back.', 'Sin fecha dura hasta que marques que ha vuelto.') }}</span>
        <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
          {{ t('Note for the team (optional)', 'Nota para el equipo (opcional)') }}
          <input v-model="form.note" type="text" maxlength="200" :class="inputClass" data-cy="member-absence-note" />
        </label>
        <p v-if="formProblem && (form.from || form.returns)" class="text-[13px] text-danger-text">{{ formProblem }}</p>
        <div class="flex gap-2">
          <button type="submit" :disabled="saving || !!formProblem" class="h-9 touch:h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface disabled:opacity-60" data-cy="member-absence-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</button>
          <button type="button" :class="button" @click="adding = false">{{ t('Cancel', 'Cancelar') }}</button>
        </div>
      </form>
    </template>
    <p v-else-if="!absences.length" class="text-[13px] text-ink-muted">{{ t('Only an owner can mark someone as away.', 'Solo un propietario puede poner a alguien en ausencia.') }}</p>

    <UiConfirmDialog
      v-if="changingReturn"
      :title="t('When are they back?', '¿Cuándo vuelve?')"
      :confirm-label="t('Save', 'Guardar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="returnBusy"
      @confirm="newReturn && setReturn(changingReturn, newReturn)"
      @cancel="changingReturn = null"
    >
      <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
        {{ t('Back on', 'Vuelve el') }}
        <input v-model="newReturn" type="date" :class="inputClass" data-cy="member-absence-new-return" />
      </label>
    </UiConfirmDialog>

    <LazyCalendarUnplannedAbsence
      v-if="moving"
      :prefill="{ who: memberId, from: moving.starts_on > today ? moving.starts_on : today, to: isOpenEndedAbsence(moving.ends_on) ? OPEN_ENDED_ABSENCE : moving.ends_on, alreadyBlocked: true }"
      @close="moving = null"
      @done="moving = null; load()"
    />
  </div>
</template>
