<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()

const editingId = ref<string | null>(null)
const legalName = ref('')
const taxId = ref('')
const saving = ref(false)
const error = ref('')

function openEditor(id: string) {
  const clinic = store.clinics.find((c) => c.id === id)
  if (!clinic) return
  editingId.value = id
  legalName.value = clinic.legal_name ?? ''
  taxId.value = clinic.tax_id ?? ''
  error.value = ''
}

async function save() {
  if (!editingId.value) return
  saving.value = true
  const { error: updateError } = await supabase
    .from('clinics')
    .update({ legal_name: legalName.value.trim() || null, tax_id: taxId.value.trim() || null })
    .eq('id', editingId.value)
  saving.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  editingId.value = null
  store.reset()
  await store.load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Fiscal Data" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">
            Legal name and tax ID shown on invoices, separate from the clinic's everyday display name. Required for invoices to be
            fiscally valid.
          </p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Clinic</th>
                  <th class="px-4 py-2">Legal name</th>
                  <th class="px-4 py-2">Tax ID</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="store.clinics.length === 0">
                  <td colspan="4" class="px-4 py-6 text-center text-ink-faint">No clinics yet -- add one in Settings &rarr; Clinics.</td>
                </tr>
                <tr v-for="c in store.clinics" :key="c.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ c.name }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">{{ c.legal_name ?? 'Not set' }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">{{ c.tax_id ?? 'Not set' }}</td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="openEditor(c.id)">Edit</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form v-if="editingId" class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="save">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Legal name</label>
              <input
                v-model="legalName"
                type="text"
                placeholder="Centro Quiropractico Columnaquiro S.L."
                class="mt-1 h-8 w-72 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Tax ID</label>
              <input
                v-model="taxId"
                type="text"
                placeholder="B12345678"
                class="mt-1 h-8 w-40 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</UiBtn>
            <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="editingId = null">Cancel</button>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
