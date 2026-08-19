<script setup lang="ts">
interface MembershipRow {
  id: string
  name: string
  price_cents: number
}

const supabase = useSupabaseClient()
const store = useAccountStore()

const memberships = ref<MembershipRow[]>([])
const loading = ref(true)

const name = ref('')
const price = ref(0)
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('memberships').select('id, name, price_cents').order('name')
  memberships.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addMembership() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('memberships').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    price_cents: Math.round(price.value * 100),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  price.value = 0
  await load()
}

async function removeMembership(id: string) {
  if (!confirm('Delete this membership plan? Patients already on it are unaffected.')) return
  await supabase.from('memberships').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Memberships</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Recurring plan templates (e.g. monthly maintenance membership).</p>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Price / period</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="3" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="memberships.length === 0">
            <td colspan="3" class="px-4 py-6 text-center text-gray-400">No membership plans yet.</td>
          </tr>
          <tr v-for="m in memberships" :key="m.id">
            <td class="px-4 py-2.5 text-gray-900">{{ m.name }}</td>
            <td class="px-4 py-2.5 text-gray-500">€{{ (m.price_cents / 100).toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-right">
              <button type="button" class="text-gray-400 hover:text-red-600" @click="removeMembership(m.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addMembership">
      <div>
        <label class="block text-sm font-medium text-gray-700">Name</label>
        <input v-model="name" type="text" required placeholder="Membresía mensual" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Price (€)</label>
        <input v-model.number="price" type="number" min="0" step="0.01" class="mt-1 w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Membership' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
