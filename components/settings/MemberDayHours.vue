<script setup lang="ts">
import { clinicDateOf } from '../../utils/clinicClock'
import { formatShift, parseShift, type ShiftRanges } from '../../utils/staffShifts'

// "Días con horario especial" on a practitioner's page: their hours on ONE
// date instead of their week's -- the Friday they never work but will this
// once, or a Tuesday they will not. Both are rows of shift_days
// (20261125125008), the same table the Turnos tab of the registro de jornada
// writes, and since that migration the calendar, online booking, the patient
// app, the staff app and the AI receptionist all read them.
//
// Saved as soon as it is added or removed, like Ausencia below it, rather
// than with the page's Guardar: it is a fact about a date, not part of the
// profile being edited.
const props = defineProps<{ memberId: string; name: string }>()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { showToast } = useToast()
const { timeZone } = useAccountTimeZone()

interface DayRow { day: string; ranges: ShiftRanges }
const today = computed(() => clinicDateOf(new Date(), timeZone.value))
const days = ref<DayRow[]>([])
const loaded = ref(false)

async function load() {
  const { data } = await supabase
    .from('shift_days')
    .select('day, ranges')
    .eq('team_member_id', props.memberId)
    .gte('day', today.value)
    .order('day')
  days.value = (data as DayRow[] | null) ?? []
  loaded.value = true
}
onMounted(load)

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const adding = ref(false)
const saving = ref(false)
const form = reactive({ day: '', working: true, hours: '' })
function startAdding() {
  form.day = ''
  form.working = true
  form.hours = ''
  adding.value = true
}
const parsed = computed(() => (form.working ? parseShift(form.hours) : []))
const formProblem = computed(() => {
  if (!form.day) return t('Pick a day.', 'Elige un día.')
  if (form.day < today.value) return t('That day has passed.', 'Ese día ya ha pasado.')
  if (form.working && !form.hours.trim()) return t('Write the hours, e.g. 09:30-14:00.', 'Escribe el horario, por ejemplo 09:30-14:00.')
  if (form.working && !parsed.value) return t('Write it as 09:30-14:00, or 09:30-14:00, 16:00-20:00 for two stretches.', 'Escríbelo como 09:30-14:00, o 09:30-14:00, 16:00-20:00 si son dos tramos.')
  return ''
})
const replacing = computed(() => days.value.some((d) => d.day === form.day))

async function save() {
  if (formProblem.value || !parsed.value || !store.accountId) return
  saving.value = true
  const { error } = await supabase
    .from('shift_days')
    .upsert({ team_member_id: props.memberId, day: form.day, account_id: store.accountId, ranges: parsed.value, updated_at: new Date().toISOString() })
  saving.value = false
  if (error) {
    showToast(t(`Could not save that day: ${error.message}`, `No se pudo guardar ese día: ${error.message}`), 'error', 8000)
    return
  }
  adding.value = false
  showToast(form.working ? t(`${props.name} works ${fmt(form.day)}.`, `${props.name} trabaja el ${fmt(form.day)}.`) : t(`${props.name} is off ${fmt(form.day)}.`, `${props.name} no trabaja el ${fmt(form.day)}.`))
  await load()
}

const removing = ref<string | null>(null)
async function remove(day: string) {
  removing.value = day
  const { error } = await supabase.from('shift_days').delete().eq('team_member_id', props.memberId).eq('day', day)
  removing.value = null
  if (error) {
    showToast(t(`Could not remove it: ${error.message}`, `No se pudo quitar: ${error.message}`), 'error', 8000)
    return
  }
  showToast(t('Back to their usual hours that day.', 'Ese día vuelve a su horario habitual.'))
  await load()
}

const button = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-50'
const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex flex-col gap-3" data-cy="member-day-hours">
    <div class="flex flex-col gap-1">
      <span class="text-[14.5px] font-semibold text-ink-900">{{ t('Days with different hours', 'Días con horario especial') }}</span>
      <span class="text-[12.5px] leading-snug text-ink-muted">{{ t('A day they work outside their usual hours, or one they do not work. Only that date changes: the calendar, online booking and the receptionist offer it as set here.', 'Un día que trabaja fuera de su horario, o uno que no trabaja. Solo cambia esa fecha: la agenda, la reserva online y la recepcionista lo ofrecen tal como lo pongas aquí.') }}</span>
    </div>

    <ul v-if="days.length" class="flex flex-col rounded-ctl border border-line">
      <li v-for="d in days" :key="d.day" class="flex flex-wrap items-center gap-2 border-t border-line-row px-3.5 py-2.5 text-[14px] first:border-t-0" data-cy="member-day-hours-row">
        <span class="min-w-0 flex-1 font-semibold first-letter:uppercase text-ink-900">{{ fmt(d.day) }}</span>
        <span v-if="d.ranges.length" class="text-ink-700">{{ formatShift(d.ranges) }}</span>
        <span v-else class="text-ink-500">{{ t('Not working', 'No trabaja') }}</span>
        <button type="button" class="h-9 touch:h-11 rounded-ctl px-3 text-[13.5px] font-semibold text-brand-text hover:bg-surface-subtle disabled:opacity-50" :disabled="removing === d.day" data-cy="member-day-hours-remove" @click="remove(d.day)">{{ t('Remove', 'Quitar') }}</button>
      </li>
    </ul>

    <button v-if="!adding" type="button" :class="[button, 'self-start']" :disabled="!loaded" data-cy="member-day-hours-add" @click="startAdding">{{ t('Add a day', 'Añadir un día') }}</button>
    <form v-else class="flex flex-col gap-3 rounded-ctl border border-line p-4" data-cy="member-day-hours-form" @submit.prevent="save">
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
          {{ t('Day', 'Día') }}
          <input v-model="form.day" type="date" :min="today" :class="inputClass" data-cy="member-day-hours-day" />
        </label>
        <div class="flex gap-1.5" role="group" :aria-label="t('That day', 'Ese día')">
          <button
            type="button"
            class="h-9 touch:h-11 rounded-pill border px-3 text-[13px] font-semibold"
            :class="form.working ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
            :aria-pressed="form.working"
            data-cy="member-day-hours-working"
            @click="form.working = true"
          >
            {{ t('Works', 'Trabaja') }}
          </button>
          <button
            type="button"
            class="h-9 touch:h-11 rounded-pill border px-3 text-[13px] font-semibold"
            :class="!form.working ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
            :aria-pressed="!form.working"
            data-cy="member-day-hours-off"
            @click="form.working = false"
          >
            {{ t('Day off', 'No trabaja') }}
          </button>
        </div>
      </div>
      <label v-if="form.working" class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
        {{ t('Hours', 'Horario') }}
        <input v-model="form.hours" type="text" inputmode="numeric" placeholder="09:30-14:00" :class="[inputClass, 'w-full max-w-[320px]']" data-cy="member-day-hours-hours" />
        <span class="text-[12.5px] font-normal text-ink-muted">{{ t('Two stretches: 09:30-14:00, 16:00-20:00', 'Dos tramos: 09:30-14:00, 16:00-20:00') }}</span>
      </label>
      <p v-if="replacing && !formProblem" class="text-[13px] text-ink-700">{{ t('That day already has hours set: these replace them.', 'Ese día ya tiene un horario: este lo sustituye.') }}</p>
      <p v-if="formProblem && (form.day || form.hours)" class="text-[13px] text-danger-text" data-cy="member-day-hours-problem">{{ formProblem }}</p>
      <div class="flex gap-2">
        <UiBtn variant="primary" type="submit" :disabled="saving || !!formProblem" data-cy="member-day-hours-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <button type="button" :class="button" @click="adding = false">{{ t('Cancel', 'Cancelar') }}</button>
      </div>
    </form>
  </div>
</template>
