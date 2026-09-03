<script setup lang="ts">
import type { Database } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

interface FieldConfig { visible: boolean; required: boolean }

const FIELDS = computed<{ key: string; label: string }[]>(() => [
  { key: 'preferred_language', label: t('Preferred Language', 'Idioma preferido') },
  { key: 'notes', label: t('Patient Note', 'Nota del paciente') },
  { key: 'date_of_birth', label: t('Date of Birth', 'Fecha de nacimiento') },
  { key: 'phone', label: t('Phone Number', 'Número de teléfono') },
  { key: 'email', label: t('Email', 'Correo electrónico') },
  { key: 'address', label: t('Address', 'Dirección') },
  { key: 'occupation', label: t('Occupation', 'Ocupación') },
  { key: 'gender', label: t('Sex', 'Sexo') },
])

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
    <PageHeader :title="t('New Patient Fields', 'Campos de nuevo paciente')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t('Configure which fields are visible and required on the Add Patient panel.', 'Configura qué campos son visibles y obligatorios en el panel de Añadir paciente.') }}</p>

          <div v-if="!loading" class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Field', 'Campo') }}</th>
                  <th class="px-4 py-2 text-center">{{ t('Visible', 'Visible') }}</th>
                  <th class="px-4 py-2 text-center">{{ t('Required', 'Obligatorio') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr>
                  <td class="px-4 py-2.5 text-ink-700">{{ t('First Name', 'Nombre') }}</td>
                  <td class="px-4 py-2.5 text-center text-ink-faint" colspan="2">{{ t('Always visible and required', 'Siempre visible y obligatorio') }}</td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 text-ink-700">{{ t('Last Name', 'Apellidos') }}</td>
                  <td class="px-4 py-2.5 text-center text-ink-faint" colspan="2">{{ t('Always visible and required', 'Siempre visible y obligatorio') }}</td>
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

          <UiBtn class="mt-4" variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
