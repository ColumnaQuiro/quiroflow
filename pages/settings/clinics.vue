<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()

const name = ref('')
const address = ref('')
const saving = ref(false)
const error = ref('')

async function addClinic() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('clinics').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    address: address.value.trim() || null,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  address.value = ''
  store.reset()
  await store.load()
}

async function removeClinic(id: string) {
  if (!confirm('Delete this clinic?')) return
  await supabase.from('clinics').delete().eq('id', id)
  store.reset()
  await store.load()
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Clinics</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Address</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="store.clinics.length === 0">
            <td colspan="3" class="px-4 py-6 text-center text-gray-400">No clinics yet.</td>
          </tr>
          <tr v-for="c in store.clinics" :key="c.id">
            <td class="px-4 py-2.5 text-gray-900">{{ c.name }}</td>
            <td class="px-4 py-2.5 text-gray-500">{{ c.address ?? 'N/A' }}</td>
            <td class="px-4 py-2.5 text-right">
              <button type="button" class="text-gray-400 hover:text-red-600" @click="removeClinic(c.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addClinic">
      <div>
        <label class="block text-sm font-medium text-gray-700">Name</label>
        <input v-model="name" type="text" required placeholder="Valencia" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Address</label>
        <input v-model="address" type="text" class="mt-1 w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Clinic' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
