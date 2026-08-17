<script setup lang="ts">
interface RoomRow {
  id: string
  name: string
  clinic_id: string
  clinics: { name: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()

const rooms = ref<RoomRow[]>([])
const loading = ref(true)

const name = ref('')
const clinicId = ref(store.currentClinicId ?? '')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('calendar_resources')
    .select('id, name, clinic_id, clinics(name)')
    .order('name')
  rooms.value = (data as unknown as RoomRow[]) ?? []
  loading.value = false
}
onMounted(load)

async function addRoom() {
  error.value = ''
  if (!name.value.trim() || !clinicId.value) return
  saving.value = true
  const { error: insertError } = await supabase.from('calendar_resources').insert({
    account_id: store.accountId!,
    clinic_id: clinicId.value,
    name: name.value.trim(),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  await load()
}

async function removeRoom(id: string) {
  if (!confirm('Delete this room?')) return
  await supabase.from('calendar_resources').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Calendar Resources</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Room</th>
            <th class="px-4 py-2">Clinic</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="3" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="rooms.length === 0">
            <td colspan="3" class="px-4 py-6 text-center text-gray-400">No rooms yet.</td>
          </tr>
          <tr v-for="r in rooms" :key="r.id">
            <td class="px-4 py-2.5 text-gray-900">{{ r.name }}</td>
            <td class="px-4 py-2.5 text-gray-500">{{ r.clinics?.name }}</td>
            <td class="px-4 py-2.5 text-right">
              <button type="button" class="text-gray-400 hover:text-red-600" @click="removeRoom(r.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addRoom">
      <div>
        <label class="block text-sm font-medium text-gray-700">Room name</label>
        <input v-model="name" type="text" required placeholder="Sala 2" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Clinic</label>
        <select v-model="clinicId" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option v-for="c in store.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Room' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
