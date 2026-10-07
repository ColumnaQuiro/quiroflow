<script setup lang="ts">
import type { Database } from '~/types/database.types'

// What the front desk is asked for when adding a patient (AddPatientModal
// reads accounts.new_patient_field_config). Each field is one of three
// states -- hidden, optional, required -- rather than two checkboxes whose
// combinations included "hidden but required", which the modal could never
// honour. The stored shape is unchanged: { visible, required } per key.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

type State = 'hidden' | 'optional' | 'required'
interface FieldConfig {
  visible: boolean
  required: boolean
}

// In the order the Add patient form shows them.
const FIELDS = computed<{ key: string; label: string; hint: string; canRequire: boolean }[]>(() => [
  { key: 'date_of_birth', label: t('Date of birth', 'Fecha de nacimiento'), hint: '', canRequire: true },
  { key: 'email', label: t('Email', 'Correo electrónico'), hint: t('For receipts and the patient app.', 'Para recibos y la app del paciente.'), canRequire: true },
  { key: 'phone', label: t('Phone number', 'Teléfono'), hint: t('For reminders and WhatsApp.', 'Para recordatorios y WhatsApp.'), canRequire: true },
  { key: 'gender', label: t('Sex', 'Sexo'), hint: '', canRequire: true },
  { key: 'occupation', label: t('Occupation', 'Ocupación'), hint: '', canRequire: true },
  // A select that always has a value, so "required" could never fail.
  { key: 'preferred_language', label: t('Preferred language', 'Idioma preferido'), hint: t('Always has a value, so it cannot be required.', 'Siempre tiene un valor, así que no puede ser obligatorio.'), canRequire: false },
  { key: 'address', label: t('Address', 'Dirección'), hint: t('Printed on facturas when there is one.', 'Se imprime en las facturas cuando la hay.'), canRequire: true },
  { key: 'notes', label: t('Patient note', 'Nota del paciente'), hint: '', canRequire: true },
])

const config = ref<Record<string, FieldConfig>>({})
const saved = ref('')
const loading = ref(true)
const saving = ref(false)

function stateOf(key: string): State {
  const c = config.value[key] ?? { visible: true, required: false }
  if (!c.visible) return 'hidden'
  return c.required ? 'required' : 'optional'
}
function setState(key: string, state: State) {
  config.value = { ...config.value, [key]: { visible: state !== 'hidden', required: state === 'required' } }
}

const dirty = computed(() => JSON.stringify(config.value) !== saved.value)

async function load() {
  const { data } = await supabase.from('accounts').select('new_patient_field_config').eq('id', store.accountId!).maybeSingle()
  config.value = (data?.new_patient_field_config as unknown as Record<string, FieldConfig>) ?? {}
  saved.value = JSON.stringify(config.value)
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  const { error } = await supabase
    .from('accounts')
    .update({ new_patient_field_config: config.value as unknown as Database['public']['Tables']['accounts']['Update']['new_patient_field_config'] })
    .eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  saved.value = JSON.stringify(config.value)
  showToast(t('Saved', 'Guardado'))
}

// The form as the front desk will see it: first and last name, the fields
// that are not hidden, and "Referred by", which is always on it.
const preview = computed(() => {
  const shown = (key: string) => stateOf(key) !== 'hidden'
  const label = (key: string) => {
    const f = FIELDS.value.find((x) => x.key === key)!
    return stateOf(key) === 'required' ? `${f.label} *` : f.label
  }
  const rows = [t('First name', 'Nombre') + ' *', t('Last name', 'Apellidos') + ' *']
  for (const key of ['date_of_birth', 'email', 'phone', 'gender']) if (shown(key)) rows.push(label(key))
  rows.push(t('Referred by', 'Origen'))
  for (const key of ['occupation', 'preferred_language', 'address', 'notes']) if (shown(key)) rows.push(label(key))
  return rows
})

const STATES: { value: State; label: () => string }[] = [
  { value: 'hidden', label: () => t('Hidden', 'Oculto') },
  { value: 'optional', label: () => t('Optional', 'Opcional') },
  { value: 'required', label: () => t('Required', 'Obligatorio') },
]
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('New Patient Fields', 'Campos de nuevo paciente')">
      <span v-if="dirty" class="text-[13px] text-ink-muted">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
      <UiBtn variant="primary" data-cy="fields-save" :disabled="saving || loading || !dirty" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[960px] flex-1 flex-col gap-4" data-cy="fields-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What the front desk is asked for when adding a patient. Everything can still be filled in later on the patient’s record.', 'Lo que se pide en recepción al añadir un paciente. Todo se puede completar después en la ficha del paciente.') }}
          </p>

          <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
            <section aria-labelledby="h-fields" class="min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-surface">
              <h2 id="h-fields" class="px-[18px] pb-3 pt-4 text-[16px] font-bold text-ink-900">{{ t('Fields', 'Campos') }}</h2>
              <div v-for="name in [t('First name', 'Nombre'), t('Last name', 'Apellidos')]" :key="name" class="flex min-h-[56px] items-center gap-3 border-t border-line-row px-[18px] py-2">
                <strong class="flex-1 text-[14.5px] text-ink-900">{{ name }}</strong>
                <span class="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                  {{ t('Always required', 'Siempre obligatorio') }}
                </span>
              </div>

              <template v-if="loading">
                <div v-for="i in 4" :key="i" class="flex items-center gap-3 border-t border-line-row px-[18px] py-4">
                  <UiSkeleton class="h-4 w-36 rounded-ctlSm" />
                  <UiSkeleton class="ml-auto h-8 w-60 rounded-ctl" />
                </div>
              </template>
              <div v-for="f in FIELDS" v-else :key="f.key" data-cy="field-row" :data-field="f.key" class="flex min-h-[56px] flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-2 sm:flex-nowrap">
                <!-- min-w makes the row wrap the control onto its own line on a
                     phone rather than squeezing the hint one word per line. -->
                <div class="flex min-w-[9rem] flex-1 flex-col gap-0.5 sm:min-w-0">
                  <strong :id="`field-${f.key}`" class="text-[14.5px] text-ink-900">{{ f.label }}</strong>
                  <span v-if="f.hint" class="text-[12.5px] text-ink-muted">{{ f.hint }}</span>
                </div>
                <div role="radiogroup" :aria-labelledby="`field-${f.key}`" class="inline-flex shrink-0 gap-0.5 rounded-[9px] bg-chip-bg p-[3px]">
                  <button
                    v-for="s in STATES"
                    :key="s.value"
                    type="button"
                    role="radio"
                    :data-cy="`field-${s.value}`"
                    :aria-checked="stateOf(f.key) === s.value"
                    :disabled="s.value === 'required' && !f.canRequire"
                    class="h-8 touch:h-11 rounded-[7px] px-3 text-[13px] disabled:cursor-not-allowed disabled:text-ink-faint"
                    :class="stateOf(f.key) === s.value ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'"
                    @click="setState(f.key, s.value)"
                  >
                    {{ s.label() }}
                  </button>
                </div>
              </div>
            </section>

            <figure class="flex w-full shrink-0 flex-col gap-2 lg:w-[320px]" aria-hidden="true">
              <figcaption class="text-[12.5px] font-semibold text-ink-500">{{ t('How Add patient looks', 'Cómo se ve Añadir paciente') }}</figcaption>
              <div class="flex flex-col gap-3 rounded-card border border-line bg-surface p-[18px] shadow-popover" data-cy="fields-preview">
                <strong class="text-[16px] text-ink-900">{{ t('Add patient', 'Añadir paciente') }}</strong>
                <div v-for="row in preview" :key="row" class="flex flex-col gap-1">
                  <span class="text-[12.5px] font-semibold text-ink-700">{{ row }}</span>
                  <span class="h-8 rounded-ctlSm border border-line-control bg-surface-subtle" />
                </div>
              </div>
            </figure>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
