<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { splitDialPrefix } from '~/utils/phone'
import { patientAge } from '~/utils/patientAge'
import { PATIENT_ATTRIBUTE_COLUMNS, normalizePatientAttributeValue, patientAttributeNewPatientKey, type PatientAttribute } from '~/utils/patientAttributes'

const emit = defineEmits<{ close: []; created: [id: string] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

// A modal dialog: focus stays inside it, Escape closes it, and focus goes
// back to whatever opened it (useFocusTrap).
const dialogPanel = ref<HTMLElement | null>(null)
const dialogTitleId = useId()
useFocusTrap(dialogPanel, () => emit('close'))
const { phoneProblem } = usePhoneValidation()
const { can, scope } = usePermission()
const { showToast } = useToast()

const firstName = ref('')
const lastName = ref('')
const dateOfBirth = ref('')
const typedAge = computed(() => patientAge(dateOfBirth.value))
const email = ref('')
const phoneCountry = ref(store.defaultPhoneCountry)
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

// The clinic's own fields that New Patient Fields puts on this form ("shown"
// there, hidden by default). Only for someone who could fill them in on the
// record afterwards: patients_edit, and clinical access for a clinical one,
// which is what the database asks of the insert.
const attributes = ref<PatientAttribute[]>([])
const attributeValues = ref<Record<string, string | null>>({})
const shownAttributes = computed(() =>
  attributes.value.filter(
    (a) =>
      fieldConfig.value[patientAttributeNewPatientKey(a.id)]?.visible &&
      can('patients_edit') &&
      (a.section === 'admin' || can('visit_notes_access')),
  ),
)

const referralSources = ref<Tables<'referral_sources'>[]>([])
onMounted(async () => {
  const [{ data: sources }, { data: account }, { data: attrs }] = await Promise.all([
    supabase.from('referral_sources').select('*').eq('status', 'active').order('name'),
    supabase.from('accounts').select('new_patient_field_config').eq('id', store.accountId!).maybeSingle(),
    supabase.from('patient_attributes').select(PATIENT_ATTRIBUTE_COLUMNS).is('archived_at', null).order('section', { ascending: false }).order('position').order('created_at'),
  ])
  referralSources.value = sources ?? []
  fieldConfig.value = (account?.new_patient_field_config as unknown as Record<string, FieldConfig>) ?? {}
  attributes.value = (attrs as PatientAttribute[] | null) ?? []
})

async function onSubmit() {
  error.value = ''
  // Before the patient row is written, not after: the number is inserted in
  // a second statement below, so letting a bad one through here would leave
  // a patient created and their number silently missing -- or worse, stored
  // as typed. The field stays optional; this only says that something typed
  // into it has to be a number.
  const phoneError = phoneProblem(phoneNumber.value, phoneCountry.value)
  if (phoneError) {
    error.value = phoneError
    return
  }
  saving.value = true

  const tags = tagsInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  // The id is made here and the row is not read back in the same statement.
  // RLS checks a returned row against the SELECT policy using the snapshot
  // the INSERT started with, and for someone who sees only their own patients
  // that policy asks my_own_patient_ids() -- which cannot yet contain the
  // patient being inserted. So `.insert().select('id')` fails with "new row
  // violates row-level security policy" for every 'own'-scope practitioner,
  // default practitioner or not; the next statement sees the row fine.
  const patientId = crypto.randomUUID()
  const { error: insertError } = await supabase
    .from('patients')
    .insert({
      id: patientId,
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
      // Someone who sees only their own patients has to be this patient's
      // practitioner, or the patient they have just created is one they
      // cannot see: the phone number below would be refused and the record
      // they land on would be "not found". The calendar's "new patient" does
      // the same with the visit's practitioner. Anyone else leaves it unset,
      // as before.
      default_practitioner_id: scope('patients_scope') === 'own' ? (store.teamMember?.id ?? null) : null,
    })

  if (insertError) {
    saving.value = false
    error.value = `${t('The patient was not created. Nothing was saved, so you can try again.', 'No se ha creado el paciente. No se ha guardado nada, así que puedes volver a intentarlo.')} (${insertError.message})`
    return
  }

  if (phoneNumber.value.trim()) {
    // A typed "+34 600…" wins over the dropdown, so the prefix isn't stored
    // twice -- once in the number and again as the country code.
    const { countryCode, number } = splitDialPrefix(phoneNumber.value, phoneCountry.value)
    const { error: numberError } = await supabase.from('patient_contact_numbers').insert({
      account_id: store.accountId!,
      patient_id: patientId,
      country_code: countryCode,
      number,
      is_whatsapp: phoneIsWhatsapp.value,
    })
    // The patient exists by now, so this is not a reason to stay on the form
    // (a second Add would create them twice) -- but a number that silently
    // failed to save is one nobody will ever message.
    if (numberError) {
      showToast(`${t('Patient created, but the phone number was not saved. Add it from their details.', 'Paciente creado, pero el teléfono no se ha guardado. Añádelo desde sus datos.')} (${numberError.message})`, 'error', 8000)
    }
  }

  // As with the number: the patient exists, so a refusal here is said and
  // not a reason to stay on the form.
  const answers = shownAttributes.value
    .map((a) => ({ attribute_id: a.id, value: normalizePatientAttributeValue(a.kind, attributeValues.value[a.id]) }))
    .filter((r): r is { attribute_id: string; value: string } => r.value !== null)
    .map((r) => ({ ...r, account_id: store.accountId!, patient_id: patientId, updated_by: store.teamMember?.id ?? null }))
  if (answers.length > 0) {
    const { error: answersError } = await supabase.from('patient_attribute_values').insert(answers)
    if (answersError) {
      showToast(`${t('Patient created, but the clinic fields were not saved. Fill them in from their record.', 'Paciente creado, pero los campos de la clínica no se han guardado. Rellénalos desde su ficha.')} (${answersError.message})`, 'error', 8000)
    }
  }

  saving.value = false
  emit('created', patientId)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-scrim/30" @click.self="emit('close')">
    <div ref="dialogPanel" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId" class="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-surface p-4 shadow-drawer sm:p-6">
      <div class="flex items-center justify-between">
        <h2 :id="dialogTitleId" class="text-[16px] font-[640] text-ink-900">{{ t('Add patient', 'Añadir paciente') }}</h2>
        <button
          type="button"
          :aria-label="t('Close', 'Cerrar')"
          class="-mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-ctlSm text-ink-faint outline-none hover:bg-surface-subtle hover:text-ink-700 focus-visible:shadow-focus touch:h-11 touch:w-11"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" class="h-4 w-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
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
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="last-name">{{ t('Last name', 'Apellidos') }}</label>
            <input
              id="last-name"
              v-model="lastName"
              type="text"
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
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
            class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
          />
          <p v-if="typedAge !== null" class="mt-1 text-[12px] text-ink-muted2" data-cy="new-patient-age">{{ t(`${typedAge} years old`, `${typedAge} años`) }}</p>
        </div>

        <!-- One column on a phone: half of 390px left the number field
             itself about two digits wide beside the country picker. -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div v-if="isVisible('email')">
            <label class="block text-sm font-medium text-ink-700" for="email">{{ t('Email', 'Correo electrónico') }}</label>
            <input
              id="email"
              v-model="email"
              type="email"
              :required="isRequired('email')"
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            />
          </div>
          <div v-if="isVisible('phone')" class="min-w-0">
            <label class="block text-sm font-medium text-ink-700" for="phone">{{ t('Phone', 'Teléfono') }}</label>
            <div class="mt-1 flex gap-2">
              <!-- See NewAppointmentPanel: unpinned, this select is as wide as
              its longest country name and squeezes the number beside it. -->
              <select
                v-model="phoneCountry"
                :aria-label="t('Country code', 'Prefijo del país')"
                class="h-9 w-[120px] shrink-0 rounded-ctl border border-line-control bg-surface px-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
              >
                <option v-for="c in COUNTRIES_BY_NAME" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
              </select>
              <input
                id="phone"
                v-model="phoneNumber"
                type="tel"
                placeholder="612 34 56 78"
                :required="isRequired('phone')"
                class="min-w-0 flex-1 h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
              />
            </div>
            <label class="mt-1.5 flex items-center gap-1.5 text-sm text-ink-muted">
              <input v-model="phoneIsWhatsapp" type="checkbox" class="h-4 w-4 accent-brand" />
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
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            >
              <option value="">{{ t('Not set', 'Sin especificar') }}</option>
              <option value="female">{{ t('Female', 'Mujer') }}</option>
              <option value="male">{{ t('Male', 'Hombre') }}</option>
              <option value="other">{{ t('Other', 'Otro') }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="referral-source">{{ t('Referral source', 'Fuente de referencia') }}</label>
            <select
              id="referral-source"
              v-model="referralSource"
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
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
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            />
          </div>
          <div v-if="isVisible('preferred_language')">
            <label class="block text-sm font-medium text-ink-700" for="preferred-language">{{ t('Preferred language', 'Idioma preferido') }}</label>
            <select
              id="preferred-language"
              v-model="preferredLanguage"
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
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
            class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
          />
        </div>

        <div v-if="isVisible('address')" class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-ink-700" for="postal-code">{{ t('Postal code', 'Código postal') }}</label>
            <input
              id="postal-code"
              v-model="postalCode"
              type="text"
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="city">{{ t('City', 'Ciudad') }}</label>
            <input
              id="city"
              v-model="city"
              type="text"
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-700" for="country">{{ t('Country', 'País') }}</label>
            <input
              id="country"
              v-model="country"
              type="text"
              class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            />
          </div>
        </div>

        <div v-if="isVisible('notes')">
          <label class="block text-sm font-medium text-ink-700" for="patient-note">{{ t('Patient note', 'Nota del paciente') }}</label>
          <textarea
            id="patient-note"
            v-model="notes"
            rows="2"
            :required="isRequired('notes')"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <div v-for="a in shownAttributes" :key="a.id" data-cy="new-patient-custom-field" :data-key="a.key">
          <label class="block text-sm font-medium text-ink-700" :for="`new-attr-${a.id}`">{{ a.label }}</label>
          <PatientsAttributeInput v-model="attributeValues[a.id]" :attribute="a" :input-id="`new-attr-${a.id}`" :required="fieldConfig[patientAttributeNewPatientKey(a.id)]?.required" />
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-700" for="clinic">{{ t('Clinic', 'Clínica') }}</label>
          <select
            id="clinic"
            v-model="clinicId"
            class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
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
            class="mt-1 w-full h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
          />
        </div>

        <p v-if="error" role="alert" class="rounded-ctl border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger-text">{{ error }}</p>

        <div class="flex gap-3">
          <UiBtn type="submit" variant="primary" :disabled="saving">
            {{ saving ? t('Saving…', 'Guardando…') : t('Add patient', 'Añadir paciente') }}
          </UiBtn>
          <UiBtn variant="ghost" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        </div>
      </form>
    </div>
  </div>
</template>
