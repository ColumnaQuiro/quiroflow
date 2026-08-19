<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const STAGE_OPTIONS = [
  { value: '', label: 'Not classified' },
  { value: 'first_visit', label: 'First visit' },
  { value: 'first_visit_offer', label: 'First visit (offer)' },
  { value: 'report', label: 'Report / exam findings' },
  { value: 'revision', label: 'Revision / check-up' },
  { value: 'maintenance', label: 'Maintenance package' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'other', label: 'Other' },
]

const types = ref<Tables<'appointment_types'>[]>([])
const loading = ref(true)

const name = ref('')
const duration = ref('30')
const price = ref('')
const color = ref('#4C6FEB')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('appointment_types').select('*').order('name')
  types.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addType() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('appointment_types').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    duration_minutes: parseInt(duration.value, 10) || 30,
    default_price_cents: Math.round((parseFloat(price.value) || 0) * 100),
    color: color.value,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  duration.value = '30'
  price.value = ''
  await load()
}

async function removeType(id: string) {
  if (!confirm('Delete this appointment type?')) return
  await supabase.from('appointment_types').delete().eq('id', id)
  await load()
}

async function toggleBookable(type: Tables<'appointment_types'>) {
  const next = !type.online_booking_enabled
  type.online_booking_enabled = next
  await supabase.from('appointment_types').update({ online_booking_enabled: next }).eq('id', type.id)
}

async function updateStage(type: Tables<'appointment_types'>, stage: string) {
  type.stage = stage || null
  await supabase.from('appointment_types').update({ stage: stage || null }).eq('id', type.id)
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Appointment Types</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Duration</th>
            <th class="px-4 py-2">Default price</th>
            <th class="px-4 py-2">Stage</th>
            <th class="px-4 py-2">Online booking</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="6" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="types.length === 0">
            <td colspan="6" class="px-4 py-6 text-center text-gray-400">No appointment types yet.</td>
          </tr>
          <tr v-for="t in types" :key="t.id">
            <td class="px-4 py-2.5 text-gray-900">
              <span class="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" :style="{ backgroundColor: t.color }"></span>
              {{ t.name }}
            </td>
            <td class="px-4 py-2.5 text-gray-500">{{ t.duration_minutes }} min</td>
            <td class="px-4 py-2.5 text-gray-500">€{{ (t.default_price_cents / 100).toFixed(2) }}</td>
            <td class="px-4 py-2.5">
              <select
                :value="t.stage ?? ''"
                class="rounded-md border border-gray-300 py-1 pl-2 pr-6 text-xs text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                @change="updateStage(t, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="s in STAGE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </td>
            <td class="px-4 py-2.5">
              <label class="flex items-center gap-2 text-gray-600">
                <input type="checkbox" :checked="t.online_booking_enabled" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" @change="toggleBookable(t)" />
                Bookable
              </label>
            </td>
            <td class="px-4 py-2.5 text-right">
              <button type="button" class="text-gray-400 hover:text-red-600" @click="removeType(t.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-gray-400">
      "Stage" lets the Statistics report count first visits, reports, revisions, etc. — pick whichever bucket each
      type maps to for you.
    </p>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addType">
      <div>
        <label class="block text-sm font-medium text-gray-700">Name</label>
        <input v-model="name" type="text" required placeholder="Ajuste Quiropractico" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Duration (min)</label>
        <input v-model="duration" type="number" min="5" step="5" class="mt-1 w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Default price (€)</label>
        <input v-model="price" type="number" step="0.01" min="0" class="mt-1 w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Color</label>
        <input v-model="color" type="color" class="mt-1 h-9 w-14 rounded-md border border-gray-300" />
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Type' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
