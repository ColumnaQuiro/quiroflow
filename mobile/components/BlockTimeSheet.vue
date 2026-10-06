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

async function save() {
  if (!context.value || saving.value) return
  error.value = ''
  const start = wholeDay.value ? startOfLocalDate(day.value, tz.value).getTime() : wallClockToUtc(day.value, from.value, tz.value)
  const end = wholeDay.value ? startOfLocalDate(nextDate(day.value), tz.value).getTime() : wallClockToUtc(day.value, to.value, tz.value)
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
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-ink-900/40 md:items-center md:justify-center" data-cy="block-time-sheet" @click.self="emit('close')">
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

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <button type="submit" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="saving" data-cy="block-save">
        {{ saving ? t('Saving…', 'Guardando…') : t('Block', 'Bloquear') }}
      </button>
      <button type="button" class="py-1 text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </form>
  </div>
</template>
