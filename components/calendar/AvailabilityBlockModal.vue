<script setup lang="ts">
interface RoomOption { id: string; name: string }
interface EditingBlock { id: string; room_id: string | null; starts_at: string; ends_at: string; note: string | null }

const props = defineProps<{
  rooms: RoomOption[]
  block?: EditingBlock
  prefillDate?: string
  prefillTime?: string
  prefillRoomId?: string
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

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

async function save() {
  error.value = ''

  const startsAt = wholeDay.value ? new Date(`${startDate.value}T00:00`) : new Date(`${startDate.value}T${startTime.value}`)
  const endsAt = wholeDay.value ? addDays(new Date(`${endDate.value}T00:00`), 1) : new Date(`${endDate.value}T${endTime.value}`)

  if (endsAt <= startsAt) {
    error.value = 'End must be after start.'
    return
  }
  saving.value = true

  const payload = {
    account_id: store.accountId!,
    clinic_id: store.currentClinicId!,
    room_id: roomId.value || null,
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
  if (!confirm('Remove this block?')) return
  saving.value = true
  const { error: deleteError } = await supabase.from('availability_blocks').delete().eq('id', props.block.id)
  saving.value = false
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900">{{ block ? 'Edit Block' : 'Block Time' }}</h2>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>

      <form class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label class="block text-sm font-medium text-gray-700">Room</label>
          <select v-model="roomId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="">Whole clinic</option>
            <option v-for="room in rooms" :key="room.id" :value="room.id">{{ room.name }}</option>
          </select>
        </div>
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="block text-sm font-medium text-gray-700">Start date</label>
            <input v-model="startDate" type="date" required class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium text-gray-700">End date</label>
            <input v-model="endDate" type="date" required :min="startDate" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input v-model="wholeDay" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
          Whole day
        </label>
        <div v-if="!wholeDay" class="flex gap-3">
          <div class="flex-1">
            <label class="block text-sm font-medium text-gray-700">Start time</label>
            <input v-model="startTime" type="time" required class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium text-gray-700">End time</label>
            <input v-model="endTime" type="time" required class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Note</label>
          <input v-model="note" type="text" placeholder="e.g. maintenance, holiday" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex items-center justify-between pt-2">
          <button v-if="block" type="button" class="text-sm text-red-600 hover:text-red-700" @click="remove">Remove block</button>
          <div class="ml-auto flex gap-2">
            <button type="button" class="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" @click="emit('close')">Cancel</button>
            <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
