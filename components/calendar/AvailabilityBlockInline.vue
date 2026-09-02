<script setup lang="ts">
interface RoomOption { id: string; name: string }

const props = defineProps<{
  rooms: RoomOption[]
  prefillDate?: string
  prefillTime?: string
  prefillRoomId?: string
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

function toDateInput(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

const roomId = ref(props.prefillRoomId ?? '')
const wholeDay = ref(false)
const startDate = ref(props.prefillDate ?? toDateInput(new Date().toISOString()))
const endDate = ref(props.prefillDate ?? toDateInput(new Date().toISOString()))
const startTime = ref(props.prefillTime ?? '09:00')
const endTime = ref('10:00')
const note = ref('')
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''

  const startsAt = wholeDay.value ? new Date(`${startDate.value}T00:00`) : new Date(`${startDate.value}T${startTime.value}`)
  const endsAt = wholeDay.value ? addDays(new Date(`${endDate.value}T00:00`), 1) : new Date(`${endDate.value}T${endTime.value}`)

  if (endsAt <= startsAt) {
    error.value = t('End must be after start.', 'La hora de fin debe ser posterior a la de inicio.')
    return
  }
  saving.value = true

  const { error: insertError } = await supabase.from('availability_blocks').insert({
    account_id: store.accountId!,
    clinic_id: store.currentClinicId!,
    room_id: roomId.value || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    note: note.value.trim() || null,
    created_by: store.teamMember?.id,
  })

  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  emit('saved')
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <div>
      <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Room', 'Sala') }}</label>
      <select v-model="roomId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
        <option value="">{{ t('Whole clinic', 'Toda la clínica') }}</option>
        <option v-for="room in rooms" :key="room.id" :value="room.id">{{ room.name }}</option>
      </select>
    </div>
    <div class="flex gap-3">
      <div class="flex-1">
        <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Start date', 'Fecha de inicio') }}</label>
        <input v-model="startDate" type="date" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
      </div>
      <div class="flex-1">
        <label class="block text-[12.5px] font-medium text-ink-600">{{ t('End date', 'Fecha de fin') }}</label>
        <input v-model="endDate" type="date" required :min="startDate" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
      </div>
    </div>
    <label class="flex items-center gap-2 text-[13px] text-ink-600">
      <input v-model="wholeDay" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
      {{ t('Whole day', 'Todo el día') }}
    </label>
    <div v-if="!wholeDay" class="flex gap-3">
      <div class="flex-1">
        <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Start time', 'Hora de inicio') }}</label>
        <input v-model="startTime" type="time" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
      </div>
      <div class="flex-1">
        <label class="block text-[12.5px] font-medium text-ink-600">{{ t('End time', 'Hora de fin') }}</label>
        <input v-model="endTime" type="time" required class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
      </div>
    </div>
    <div>
      <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Note', 'Nota') }}</label>
      <input v-model="note" type="text" :placeholder="t('e.g. maintenance, holiday', 'p. ej. mantenimiento, festivo')" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
    </div>

    <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>

    <div class="flex justify-end gap-2 pt-2">
      <UiBtn variant="secondary" :disabled="saving" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
    </div>
  </form>
</template>
