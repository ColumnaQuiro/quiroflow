<script setup lang="ts">
interface RoomOption { id: string; name: string }
interface TeamMemberOption { id: string; full_name: string }
interface EditingBlock { id: string; room_id: string | null; practitioner_id: string | null; starts_at: string; ends_at: string; note: string | null }

const props = defineProps<{
  rooms: RoomOption[]
  teamMembers: TeamMemberOption[]
  block?: EditingBlock
  prefillDate?: string
  prefillTime?: string
  prefillRoomId?: string
  prefillPractitionerId?: string
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

// A modal dialog: focus stays inside it, Escape closes it, and focus goes
// back to whatever opened it (useFocusTrap).
const dialogPanel = ref<HTMLElement | null>(null)
const dialogTitleId = useId()
useFocusTrap(dialogPanel, () => emit('close'))

function toDateInput(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toTimeInput(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function addDays(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

// A whole-day block was saved as [day 00:00, next day 00:00) -- detect that
// shape on edit so re-opening it shows "Whole day" checked instead of a
// start/end time of "00:00"/"00:00" on two different days.
const startsAtDate = props.block ? new Date(props.block.starts_at) : null
const endsAtDate = props.block ? new Date(props.block.ends_at) : null
const inferredWholeDay = !!(
  startsAtDate &&
  endsAtDate &&
  startsAtDate.getHours() === 0 &&
  startsAtDate.getMinutes() === 0 &&
  endsAtDate.getHours() === 0 &&
  endsAtDate.getMinutes() === 0
)

const roomId = ref(props.block?.room_id ?? props.prefillRoomId ?? '')
const practitionerId = ref(props.block?.practitioner_id ?? props.prefillPractitionerId ?? '')
// Same late-prefill race as NewAppointmentPanel: the calendar only knows its
// practitioners after mount, so a modal opened before that is handed '' --
// which here reads as "All practitioners", quietly widening a block the user
// meant for the practitioner whose tab they were looking at. Adopt the
// prefill when it arrives, unless they've already picked (choosing "All
// practitioners" is also '') or we're editing a block that has its own.
const practitionerChosen = ref(false)
watch(
  () => props.prefillPractitionerId,
  (id) => {
    if (id && !practitionerChosen.value && !props.block) practitionerId.value = id
  },
)
const wholeDay = ref(inferredWholeDay)
const startDate = ref(props.block ? toDateInput(props.block.starts_at) : (props.prefillDate ?? toDateInput(new Date().toISOString())))
const endDate = ref(
  props.block
    ? toDateInput(inferredWholeDay ? addDays(endsAtDate!, -1).toISOString() : props.block.ends_at)
    : (props.prefillDate ?? toDateInput(new Date().toISOString())),
)
const startTime = ref(props.block ? toTimeInput(props.block.starts_at) : (props.prefillTime ?? '09:00'))
const endTime = ref(props.block ? toTimeInput(props.block.ends_at) : '10:00')
const note = ref(props.block?.note ?? '')
const error = ref('')
const saving = ref(false)

const startsAtOf = () => (wholeDay.value ? new Date(`${startDate.value}T00:00`) : new Date(`${startDate.value}T${startTime.value}`))
const endsAtOf = () => (wholeDay.value ? addDays(new Date(`${endDate.value}T00:00`), 1) : new Date(`${endDate.value}T${endTime.value}`))
// For the visits it would sit on (BlockClashes): null while half-typed.
const isoOrNull = (d: Date) => (Number.isNaN(d.getTime()) ? null : d.toISOString())
const clashStartsAt = computed(() => isoOrNull(startsAtOf()))
const clashEndsAt = computed(() => isoOrNull(endsAtOf()))
const clashCount = ref(0)

async function save() {
  error.value = ''

  const startsAt = startsAtOf()
  const endsAt = endsAtOf()

  if (endsAt <= startsAt) {
    error.value = t('End must be after start.', 'La hora de fin debe ser posterior a la de inicio.')
    return
  }
  saving.value = true

  const payload = {
    account_id: store.accountId!,
    clinic_id: store.currentClinicId!,
    room_id: roomId.value || null,
    practitioner_id: practitionerId.value || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    note: note.value.trim() || null,
    created_by: store.teamMember?.id,
  }

  const result = props.block
    ? await supabase.from('availability_blocks').update(payload).eq('id', props.block.id)
    : await supabase.from('availability_blocks').insert(payload)

  saving.value = false
  if (result.error) {
    error.value = result.error.message
    return
  }
  emit('saved')
}

async function remove() {
  if (!props.block) return
  if (!confirm(t('Remove this block?', '¿Eliminar este bloqueo?'))) return
  saving.value = true
  const { error: deleteError } = await supabase.from('availability_blocks').delete().eq('id', props.block.id)
  saving.value = false
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  emit('saved')
}

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/30 p-4" @click.self="emit('close')">
    <div ref="dialogPanel" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId" class="max-h-full w-full overflow-y-auto max-w-sm rounded-card border border-line bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <h2 :id="dialogTitleId" class="text-[16px] font-[640] text-ink-900">{{ block ? t('Edit Block', 'Editar bloqueo') : t('Block Time', 'Bloquear horario') }}</h2>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-ink-faint hover:text-ink-600 -m-2 p-2 touch:-m-3 touch:p-3" @click="emit('close')">✕</button>
      </div>

      <form class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label :for="`${fieldId}-practitionerId`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Practitioner', 'Profesional') }}</label>
          <select :id="`${fieldId}-practitionerId`" v-model="practitionerId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" @change="practitionerChosen = true">
            <option value="">{{ t('All practitioners', 'Todos los profesionales') }}</option>
            <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
          </select>
        </div>
        <div>
          <label :for="`${fieldId}-roomId`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Room', 'Sala') }}</label>
          <select :id="`${fieldId}-roomId`" v-model="roomId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
            <option value="">{{ t('Whole clinic', 'Toda la clínica') }}</option>
            <option v-for="room in rooms" :key="room.id" :value="room.id">{{ room.name }}</option>
          </select>
        </div>
        <div class="flex gap-3">
          <div class="flex-1">
            <label :for="`${fieldId}-startDate`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Start date', 'Fecha de inicio') }}</label>
            <input :id="`${fieldId}-startDate`" v-model="startDate" type="date" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
          <div class="flex-1">
            <label :for="`${fieldId}-endDate`" class="block text-[12.5px] font-medium text-ink-600">{{ t('End date', 'Fecha de fin') }}</label>
            <input :id="`${fieldId}-endDate`" v-model="endDate" type="date" required :min="startDate" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
        </div>
        <label class="flex items-center gap-2 text-[13px] text-ink-600">
          <input v-model="wholeDay" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
          {{ t('Whole day', 'Todo el día') }}
        </label>
        <div v-if="!wholeDay" class="flex gap-3">
          <div class="flex-1">
            <label :for="`${fieldId}-startTime`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Start time', 'Hora de inicio') }}</label>
            <input :id="`${fieldId}-startTime`" v-model="startTime" type="time" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
          <div class="flex-1">
            <label :for="`${fieldId}-endTime`" class="block text-[12.5px] font-medium text-ink-600">{{ t('End time', 'Hora de fin') }}</label>
            <input :id="`${fieldId}-endTime`" v-model="endTime" type="time" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>
        </div>
        <div>
          <label :for="`${fieldId}-note`" class="block text-[12.5px] font-medium text-ink-600">{{ t('Note', 'Nota') }}</label>
          <input :id="`${fieldId}-note`" v-model="note" type="text" :placeholder="t('e.g. maintenance, holiday', 'p. ej. mantenimiento, festivo')" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
        </div>

        <CalendarBlockClashes v-model:count="clashCount" :starts-at="clashStartsAt" :ends-at="clashEndsAt" :practitioner-id="practitionerId || null" :room-id="roomId || null" />

        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>

        <div class="flex items-center justify-between pt-2">
          <button v-if="block" type="button" class="text-[13px] text-danger-text hover:opacity-80" @click="remove">{{ t('Remove block', 'Eliminar bloqueo') }}</button>
          <div class="ml-auto flex gap-2">
            <UiBtn variant="secondary" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : clashCount ? t('Block anyway', 'Bloquear igualmente') : t('Save', 'Guardar') }}</UiBtn>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
