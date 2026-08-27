<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const methods = ref<Tables<'payment_methods'>[]>([])
const loading = ref(true)
const name = ref('')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('payment_methods').select('*').order('sort_order').order('name')
  methods.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addMethod() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('payment_methods').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    sort_order: methods.value.length,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  await load()
}

async function toggleActive(method: Tables<'payment_methods'>) {
  method.is_active = !method.is_active
  await supabase.from('payment_methods').update({ is_active: method.is_active }).eq('id', method.id)
}

async function removeMethod(id: string) {
  if (!confirm('Delete this payment method?')) return
  await supabase.from('payment_methods').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Payment Methods" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">
            The methods staff can record a payment against. Cash and Card are seeded by default -- add others (e.g. Bank Transfer) or deactivate ones you don't use.
          </p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Name</th>
                  <th class="px-4 py-2">Status</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="3" class="px-4 py-6 text-center text-ink-faint">Loading…</td>
                </tr>
                <tr v-for="m in methods" :key="m.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ m.name }}</td>
                  <td class="px-4 py-2.5">
                    <button
                      type="button"
                      class="rounded-pill px-2 py-0.5 text-[11px] font-medium"
                      :class="m.is_active ? 'bg-success-bg text-success-text' : 'bg-chip-bg text-chip-text'"
                      @click="toggleActive(m)"
                    >
                      {{ m.is_active ? 'Active' : 'Inactive' }}
                    </button>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeMethod(m.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addMethod">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Name</label>
              <input v-model="name" type="text" required placeholder="Bank Transfer" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Adding…' : 'Add Method' }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
          <p class="mt-3 text-[12px] text-ink-faint">
            "Credit on account" and write-offs are separate, built-in payment types (tied to a patient's real credit balance) and aren't managed here.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
