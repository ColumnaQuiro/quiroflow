<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const services = ref<Tables<'services_products'>[]>([])
const loading = ref(true)

const name = ref('')
const price = ref('')
const taxRate = ref('0')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('services_products').select('*').order('name')
  services.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addService() {
  error.value = ''
  if (!name.value.trim() || !price.value) return
  saving.value = true
  const { error: insertError } = await supabase.from('services_products').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    price_cents: Math.round(parseFloat(price.value) * 100),
    tax_rate: parseFloat(taxRate.value) || 0,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  price.value = ''
  taxRate.value = '0'
  await load()
}

async function removeService(id: string) {
  if (!confirm('Delete this service?')) return
  await supabase.from('services_products').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Services &amp; Products</h1>
      <NuxtLink to="/billing" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Billing</NuxtLink>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Price</th>
            <th class="px-4 py-2">Tax rate</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="4" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="services.length === 0">
            <td colspan="4" class="px-4 py-6 text-center text-gray-400">No services yet.</td>
          </tr>
          <tr v-for="s in services" :key="s.id">
            <td class="px-4 py-2.5 text-gray-900">{{ s.name }}</td>
            <td class="px-4 py-2.5 text-gray-500">€{{ (s.price_cents / 100).toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-gray-500">{{ s.tax_rate }}%</td>
            <td class="px-4 py-2.5 text-right">
              <button type="button" class="text-gray-400 hover:text-red-600" @click="removeService(s.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addService">
      <div>
        <label class="block text-sm font-medium text-gray-700">Name</label>
        <input v-model="name" type="text" required placeholder="Ajuste Quiropractico" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Price (€)</label>
        <input v-model="price" type="number" step="0.01" min="0" required class="mt-1 w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Tax rate (%)</label>
        <input v-model="taxRate" type="number" step="0.01" min="0" class="mt-1 w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Service' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
