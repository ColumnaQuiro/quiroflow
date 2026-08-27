<script setup lang="ts">
import type { Database } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

interface FieldConfig { visible: boolean; required: boolean }

const FIELDS: { key: string; label: string }[] = [
  { key: 'preferred_language', label: 'Preferred Language' },
  { key: 'notes', label: 'Patient Note' },
  { key: 'date_of_birth', label: 'Date of Birth' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'gender', label: 'Sex' },
]

const config = ref<Record<string, FieldConfig>>({})
const loading = ref(true)
const saving = ref(false)

function fieldConfig(key: string): FieldConfig {
  return config.value[key] ?? { visible: true, required: false }
}

async function load() {
  loading.value = true
  const { data } = await supabase.from('accounts').select('new_patient_field_config').eq('id', store.accountId!).maybeSingle()
  config.value = (data?.new_patient_field_config as unknown as Record<string, FieldConfig>) ?? {}
  loading.value = false
}
onMounted(load)

function setVisible(key: string, visible: boolean) {
  const current = fieldConfig(key)
  config.value = { ...config.value, [key]: { visible, required: visible ? current.required : false } }
}
function setRequired(key: string, required: boolean) {
  const current = fieldConfig(key)
  config.value = { ...config.value, [key]: { visible: true, required } }
}

async function save() {
  saving.value = true
  await supabase.from('accounts').update({ new_patient_field_config: config.value as unknown as Database['public']['Tables']['accounts']['Update']['new_patient_field_config'] }).eq('id', store.accountId!)
  saving.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="New Patient Fields" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">Configure which fields are visible and required on the Add Patient panel.</p>

          <div v-if="!loading" class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Field</th>
                  <th class="px-4 py-2 text-center">Visible</th>
                  <th class="px-4 py-2 text-center">Required</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr>
                  <td class="px-4 py-2.5 text-ink-700">First Name</td>
                  <td class="px-4 py-2.5 text-center text-ink-faint" colspan="2">Always visible and required</td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 text-ink-700">Last Name</td>
                  <td class="px-4 py-2.5 text-center text-ink-faint" colspan="2">Always visible and required</td>
                </tr>
                <tr v-for="f in FIELDS" :key="f.key">
                  <td class="px-4 py-2.5 text-ink-700">{{ f.label }}</td>
                  <td class="px-4 py-2.5 text-center">
                    <input type="checkbox" :checked="fieldConfig(f.key).visible" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" @change="setVisible(f.key, ($event.target as HTMLInputElement).checked)" />
                  </td>
                  <td class="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      :checked="fieldConfig(f.key).required"
                      :disabled="!fieldConfig(f.key).visible"
                      class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand disabled:opacity-40"
                      @change="setRequired(f.key, ($event.target as HTMLInputElement).checked)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <UiBtn class="mt-4" variant="primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
