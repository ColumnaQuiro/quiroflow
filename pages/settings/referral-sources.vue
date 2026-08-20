<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const sources = ref<Tables<'referral_sources'>[]>([])
const loading = ref(true)
const name = ref('')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('referral_sources').select('*').order('name')
  sources.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addSource() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('referral_sources').insert({
    account_id: store.accountId!,
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

async function removeSource(id: string) {
  if (!confirm('Delete this referral source?')) return
  await supabase.from('referral_sources').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Referral Sources</h1>
      <p class="mt-1 text-sm text-gray-500">The options available on a patient's "Referral source" field, and what reports group by.</p>

      <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table class="w-full text-sm">
          <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th class="px-4 py-2">Name</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-if="loading">
              <td colspan="2" class="px-4 py-6 text-center text-gray-400">Loading…</td>
            </tr>
            <tr v-else-if="sources.length === 0">
              <td colspan="2" class="px-4 py-6 text-center text-gray-400">No referral sources yet.</td>
            </tr>
            <tr v-for="s in sources" :key="s.id">
              <td class="px-4 py-2.5 text-gray-900">{{ s.name }}</td>
              <td class="px-4 py-2.5 text-right">
                <button type="button" class="text-gray-400 hover:text-red-600" @click="removeSource(s.id)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addSource">
        <div>
          <label class="block text-sm font-medium text-gray-700">Name</label>
          <input v-model="name" type="text" required placeholder="TikTok" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ saving ? 'Adding…' : 'Add Source' }}
        </button>
      </form>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
