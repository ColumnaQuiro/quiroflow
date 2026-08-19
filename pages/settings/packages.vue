<script setup lang="ts">
interface PackageRow {
  id: string
  name: string
  session_count: number
  price_cents: number
}

const supabase = useSupabaseClient()
const store = useAccountStore()

const packages = ref<PackageRow[]>([])
const loading = ref(true)

const name = ref('')
const sessionCount = ref(10)
const price = ref(0)
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('packages').select('id, name, session_count, price_cents').order('name')
  packages.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addPackage() {
  error.value = ''
  if (!name.value.trim() || sessionCount.value <= 0) return
  saving.value = true
  const { error: insertError } = await supabase.from('packages').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    session_count: sessionCount.value,
    price_cents: Math.round(price.value * 100),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  sessionCount.value = 10
  price.value = 0
  await load()
}

async function removePackage(id: string) {
  if (!confirm('Delete this package template? Existing purchases are unaffected.')) return
  await supabase.from('packages').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Packages / Bonos</h1>
    <p class="mt-1 text-sm text-gray-500">Session bundle templates you can sell to patients (e.g. "Bono 10 sesiones").</p>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Sessions</th>
            <th class="px-4 py-2">Price</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="4" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="packages.length === 0">
            <td colspan="4" class="px-4 py-6 text-center text-gray-400">No packages yet.</td>
          </tr>
          <tr v-for="p in packages" :key="p.id">
            <td class="px-4 py-2.5 text-gray-900">{{ p.name }}</td>
            <td class="px-4 py-2.5 text-gray-500">{{ p.session_count }}</td>
            <td class="px-4 py-2.5 text-gray-500">€{{ (p.price_cents / 100).toFixed(2) }}</td>
            <td class="px-4 py-2.5 text-right">
              <button type="button" class="text-gray-400 hover:text-red-600" @click="removePackage(p.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addPackage">
      <div>
        <label class="block text-sm font-medium text-gray-700">Name</label>
        <input v-model="name" type="text" required placeholder="Bono 10 sesiones" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Sessions</label>
        <input v-model.number="sessionCount" type="number" min="1" required class="mt-1 w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Price (€)</label>
        <input v-model.number="price" type="number" min="0" step="0.01" class="mt-1 w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Package' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
