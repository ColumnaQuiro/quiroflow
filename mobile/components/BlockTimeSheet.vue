<script setup lang="ts">
// "Bloquear tiempo" on the agenda: the web's availability block
// (components/calendar/AvailabilityBlockModal.vue) as a sheet. Same row --
// account, clinic, practitioner or nobody (the whole clinic), start, end,
// note, created_by -- read in the CLINIC's time zone, so a block set from a
// phone abroad still closes the right hours. No room: the app's agenda is by
// practitioner; room blocks stay a web action.
//
// Someone who sees only their own diary can only block their own time; a
// whole-clinic closure is for whoever sees the whole clinic.
//
// Visits already booked inside the time are listed before saving, as on the
// web (components/calendar/BlockClashes.vue), and the button becomes "Block
// anyway": a block moves and cancels nothing, they stay booked.
import { appointmentsUnderBlock } from '../../utils/moveClash'

const props = defineProps<{
  date: string
  /** HH:MM to start from (a slot held on the timeline). */
  time?: string | null
  practitionerId?: string | null
  practitioners: { id: string; full_name: string }[]
}>()
const emit = defineEmits<{ saved: []; close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { context, ownDiaryOnly } = usePractitionerContext()
const tz = computed(() => context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE)

function plusHour(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const day = ref(props.date)
const wholeDay = ref(false)
const from = ref(props.time ?? '13:00')
const to = ref(plusHour(from.value))
// Their own diary by default when they have one; otherwise the column it was
// opened from, or the whole clinic.
const me = context.value?.teamMemberId ?? ''
const who = ref<string>(ownDiaryOnly.value ? me : (props.practitionerId ?? (props.practitioners.some((p) => p.id === me) ? me : '')))
const note = ref('')
const error = ref('')
const saving = ref(false)

const options = computed(() => {
  if (ownDiaryOnly.value && context.value) return [{ id: context.value.teamMemberId, full_name: context.value.fullName }]
  return props.practitioners
})

const startMs = () => (wholeDay.value ? startOfLocalDate(day.value, tz.value).getTime() : wallClockToUtc(day.value, from.value, tz.value))
const endMs = () => (wholeDay.value ? startOfLocalDate(nextDate(day.value), tz.value).getTime() : wallClockToUtc(day.value, to.value, tz.value))

interface UnderBlock {
  id: string
  starts_at: string
  ends_at: string
  practitioner_id: string | null
  room_id: string | null
  clinic_id: string | null
  status: string | null
  deleted_at: string | null
  patients: { first_name: string; last_name: string | null } | null
}
const clashes = ref<UnderBlock[]>([])
let run = 0
async function checkClashes() {
  const mine = ++run
  const c = context.value
  let s: number, e: number
  try {
    s = startMs()
    e = endMs()
  } catch {
    s = e = NaN
  }
  if (!c || !day.value || !Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    clashes.value = []
    return
  }
  const startsAt = new Date(s).toISOString()
  const endsAt = new Date(e).toISOString()
  let q = supabase
    .from('appointments')
    .select('id, starts_at, ends_at, practitioner_id, room_id, clinic_id, status, deleted_at, patients(first_name, last_name)')
    .eq('account_id', c.accountId)
    .is('deleted_at', null)
    .not('status', 'in', '(cancelled,no_show)')
    .lt('starts_at', endsAt)
    .gt('ends_at', startsAt)
    .order('starts_at')
    .limit(100)
  q = who.value ? q.eq('practitioner_id', who.value) : q.eq('clinic_id', c.clinicId)
  const { data } = await q
  if (mine !== run) return
  clashes.value = appointmentsUnderBlock({ practitionerId: who.value || null, roomId: null, clinicId: c.clinicId, startsAt, endsAt }, (data as unknown as UnderBlock[] | null) ?? [])
}
let timer: ReturnType<typeof setTimeout> | undefined
watch([day, wholeDay, from, to, who, () => context.value?.accountId], () => {
  clearTimeout(timer)
  timer = setTimeout(checkClashes, 250)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
const clashName = (v: UnderBlock) => `${v.patients?.first_name ?? ''} ${v.patients?.last_name ?? ''}`.trim() || t('Patient', 'Paciente')

async function save() {
  if (!context.value || saving.value) return
  error.value = ''
  const start = startMs()
  const end = endMs()
  if (end <= start) {
    error.value = t('End must be after start.', 'La hora de fin debe ser posterior a la de inicio.')
    return
  }
  saving.value = true
  const { error: e } = await supabase.from('availability_blocks').insert({
    account_id: context.value.accountId,
    clinic_id: context.value.clinicId,
    room_id: null,
    practitioner_id: who.value || null,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    note: note.value.trim() || null,
    created_by: context.value.teamMemberId,
  } as never)
  saving.value = false
  if (e) {
    error.value = e.message
    return
  }
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="block-time-sheet" @click.self="emit('close')">
    <form
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[440px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Block time', 'Bloquear tiempo')"
      @submit.prevent="save"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <p class="text-[17px] font-semibold text-ink-900">{{ t('Block time', 'Bloquear tiempo') }}</p>
      <p class="-mt-1.5 text-[12.5px] leading-snug text-ink-muted">{{ t('Nothing can be booked in it, online or at the desk.', 'No se puede reservar en ese tiempo, ni online ni desde recepción.') }}</p>

      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Day', 'Día') }}
        <input v-model="day" type="date" required class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900" />
      </label>
      <label class="flex items-center justify-between gap-3 text-[14px] text-ink-700">
        {{ t('Whole day', 'Todo el día') }}
        <input v-model="wholeDay" type="checkbox" class="h-5 w-5 accent-brand" data-cy="block-whole-day" />
      </label>
      <div v-if="!wholeDay" class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('From', 'Desde') }}
          <input v-model="from" type="time" step="300" required class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900" data-cy="block-from" />
        </label>
        <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('To', 'Hasta') }}
          <input v-model="to" type="time" step="300" required class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900" data-cy="block-to" />
        </label>
      </div>
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('For', 'Para') }}
        <select v-model="who" class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" data-cy="block-who">
          <option v-for="p in options" :key="p.id" :value="p.id">{{ p.full_name }}</option>
          <option v-if="!ownDiaryOnly" value="">{{ t('The whole clinic', 'Toda la clínica') }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Note', 'Nota') }}
        <input v-model="note" type="text" :placeholder="t('Training, lunch, holiday…', 'Formación, comida, vacaciones…')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900" data-cy="block-note" />
      </label>

      <div v-if="clashes.length" role="status" class="rounded-card border border-warning-border bg-warning-bg px-3.5 py-3 text-[13px]" data-cy="block-clashes">
        <p class="font-semibold text-warning-text">
          {{ clashes.length === 1 ? t('There is already a visit booked in this time', 'Ya hay una cita reservada en este horario') : t(`There are already ${clashes.length} visits booked in this time`, `Ya hay ${clashes.length} citas reservadas en este horario`) }}
        </p>
        <ul class="mt-1.5 flex flex-col gap-0.5 text-ink-700">
          <li v-for="v in clashes.slice(0, 6)" :key="v.id" class="truncate" data-cy="block-clash">{{ clinicTimeLabel(new Date(v.starts_at), tz) }} · {{ clashName(v) }}</li>
          <li v-if="clashes.length > 6" class="text-ink-muted">{{ t(`and ${clashes.length - 6} more`, `y ${clashes.length - 6} más`) }}</li>
        </ul>
        <p class="mt-1.5 text-[12.5px] text-ink-muted">{{ t('Blocking does not move or cancel them: they stay booked.', 'Bloquear no las mueve ni las cancela: siguen reservadas.') }}</p>
      </div>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <AppButton variant="primary" type="submit" :disabled="saving" data-cy="block-save">
        {{ saving ? t('Saving…', 'Guardando…') : clashes.length ? t('Block anyway', 'Bloquear igualmente') : t('Block', 'Bloquear') }}
      </AppButton>
      <AppButton variant="quiet" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</AppButton>
    </form>
  </div>
</template>
