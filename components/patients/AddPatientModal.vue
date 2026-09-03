<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const emit = defineEmits<{ close: []; created: [id: string] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const firstName = ref('')
const lastName = ref('')
const dateOfBirth = ref('')
const email = ref('')
const phoneCountry = ref('ES')
const phoneNumber = ref('')
const phoneIsWhatsapp = ref(false)
const clinicId = ref(store.currentClinicId ?? '')
const tagsInput = ref('')
const gender = ref('')
const address = ref('')
const postalCode = ref('')
const city = ref('')
const country = ref('')
const referralSource = ref('')
const occupation = ref('')
const preferredLanguage = ref('es')
const notes = ref('')
const error = ref('')
const saving = ref(false)

interface FieldConfig { visible: boolean; required: boolean }
const fieldConfig = ref<Record<string, FieldConfig>>({})
function isVisible(key: string) {
  return fieldConfig.value[key]?.visible ?? true
}
function isRequired(key: string) {
  return fieldConfig.value[key]?.required ?? false
}

const referralSources = ref<Tables<'referral_sources'>[]>([])
onMounted(async () => {
  const [{ data: sources }, { data: account }] = await Promise.all([
    supabase.from('referral_sources').select('*').eq('status', 'active').order('name'),
    supabase.from('accounts').select('new_patient_field_config').eq('id', store.accountId!).maybeSingle(),
  ])
  referralSources.value = sources ?? []
  fieldConfig.value = (account?.new_patient_field_config as unknown as Record<string, FieldConfig>) ?? {}
})

async function onSubmit() {
  error.value = ''
  saving.value = true

  const tags = tagsInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const { data, error: insertError } = await supabase
    .from('patients')
    .insert({
      account_id: store.accountId!,
      clinic_id: clinicId.value || null,
      first_name: firstName.value,
      last_name: lastName.value || null,
      date_of_birth: dateOfBirth.value || null,
      email: email.value || null,
      gender: gender.value || null,
      address: address.value || null,
      postal_code: postalCode.value || null,
      city: city.value || null,
      country: country.value || null,
      referral_source: referralSource.value || null,
      occupation: occupation.value || null,
      preferred_language: preferredLanguage.value,
      notes: notes.value || null,
      tags,
    })
    .select('id')
    .single()

  if (insertError) {
    saving.value = false
    error.value = insertError.message
    return
  }

  if (phoneNumber.value.trim()) {
    await supabase.from('patient_contact_numbers').insert({
      account_id: store.accountId!,
      patient_id: data.id,
      country_code: phoneCountry.value,
      number: phoneNumber.value.trim(),
      is_whatsapp: phoneIsWhatsapp.value,
    })
  }

  saving.value = false
  emit('created', data.id)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-ink-900/30" @click.self="emit('close')">
    <div class="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <h2 class="text-[16px] font-[640] text-ink-900">{{ t('Add Patient', 'Añadir paciente') }}</h2>
        <button type="button" class="text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>

      <form class="mt-4 space-y-4" @submit.prevent="onSubmit">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-ink-700" for="first-name">{{ t('First name', 'Nombre') }}</label>
            <input
              id="first-name"
              v-model="firstName"
              type="text"
              required
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="last-name">{{ t('Last name', 'Apellidos') }}</label>
            <input
              id="last-name"
              v-model="lastName"
              type="text"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        </div>

        <div v-if="isVisible('date_of_birth')">
          <label class="block text-sm font-medium text-ink-700" for="dob">{{ t('Date of birth', 'Fecha de nacimiento') }}</label>
          <input
            id="dob"
            v-model="dateOfBirth"
            type="date"
            :required="isRequired('date_of_birth')"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div v-if="isVisible('email')">
            <label class="block text-sm font-medium text-ink-700" for="email">{{ t('Email', 'Correo electrónico') }}</label>
            <input
              id="email"
              v-model="email"
              type="email"
              :required="isRequired('email')"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div v-if="isVisible('phone')" class="min-w-0">
            <label class="block text-sm font-medium text-ink-700">{{ t('Phone', 'Teléfono') }}</label>
            <div class="mt-1 flex gap-2">
              <select
                v-model="phoneCountry"
                class="shrink-0 rounded-ctl border border-line-control px-2 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }}</option>
              </select>
              <input
                v-model="phoneNumber"
                type="tel"
                placeholder="612 34 56 78"
                :required="isRequired('phone')"
                class="min-w-0 flex-1 rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <label class="mt-1.5 flex items-center gap-1.5 text-sm text-ink-muted">
              <input v-model="phoneIsWhatsapp" type="checkbox" class="rounded border-line-control accent-brand focus:ring-brand" />
              {{ t('This number has WhatsApp', 'Este número tiene WhatsApp') }}
            </label>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div v-if="isVisible('gender')">
            <label class="block text-sm font-medium text-ink-700" for="gender">{{ t('Sex', 'Sexo') }}</label>
            <select
              id="gender"
              v-model="gender"
              :required="isRequired('gender')"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">{{ t('Not set', 'Sin especificar') }}</option>
              <option value="female">{{ t('Female', 'Mujer') }}</option>
              <option value="male">{{ t('Male', 'Hombre') }}</option>
              <option value="other">{{ t('Other', 'Otro') }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="referral-source">{{ t('Referral source', 'Origen de la referencia') }}</label>
            <select
              id="referral-source"
              v-model="referralSource"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">{{ t('Not set', 'Sin especificar') }}</option>
              <option v-for="s in referralSources" :key="s.id" :value="s.name">{{ s.name }}</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div v-if="isVisible('occupation')">
            <label class="block text-sm font-medium text-ink-700" for="occupation">{{ t('Occupation', 'Profesión') }}</label>
            <input
              id="occupation"
              v-model="occupation"
              type="text"
              :required="isRequired('occupation')"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div v-if="isVisible('preferred_language')">
            <label class="block text-sm font-medium text-ink-700" for="preferred-language">{{ t('Preferred Language', 'Idioma preferido') }}</label>
            <select
              id="preferred-language"
              v-model="preferredLanguage"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="ca">Català</option>
              <option value="fr">Français</option>
            </select>
          </div>
        </div>

        <div v-if="isVisible('address')">
          <label class="block text-sm font-medium text-ink-700" for="address">{{ t('Street address', 'Dirección') }}</label>
          <input
            id="address"
            v-model="address"
            type="text"
            :placeholder="t('For invoices', 'Para facturas')"
            :required="isRequired('address')"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div v-if="isVisible('address')" class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-ink-700" for="postal-code">{{ t('Postal code', 'Código postal') }}</label>
            <input
              id="postal-code"
              v-model="postalCode"
              type="text"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="city">{{ t('City', 'Ciudad') }}</label>
            <input
              id="city"
              v-model="city"
              type="text"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="country">{{ t('Country', 'País') }}</label>
            <input
              id="country"
              v-model="country"
              type="text"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        </div>

        <div v-if="isVisible('notes')">
          <label class="block text-sm font-medium text-ink-700" for="patient-note">{{ t('Patient Note', 'Nota del paciente') }}</label>
          <textarea
            id="patient-note"
            v-model="notes"
            rows="2"
            :required="isRequired('notes')"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-700" for="clinic">{{ t('Clinic', 'Clínica') }}</label>
          <select
            id="clinic"
            v-model="clinicId"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="">{{ t('No primary clinic', 'Sin clínica principal') }}</option>
            <option v-for="clinic in store.clinics" :key="clinic.id" :value="clinic.id">
              {{ clinic.name }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-700" for="tags">{{ t('Tags', 'Etiquetas') }}</label>
          <input
            id="tags"
            v-model="tagsInput"
            type="text"
            :placeholder="t('comma, separated, tags', 'etiquetas, separadas, por, comas')"
            class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>

        <div class="flex gap-3">
          <UiBtn type="submit" variant="primary" :disabled="saving">
            {{ saving ? t('Saving…', 'Guardando…') : t('Add Patient', 'Añadir paciente') }}
          </UiBtn>
          <button type="button" class="rounded-ctl px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-subtle" @click="emit('close')">
            {{ t('Cancel', 'Cancelar') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
