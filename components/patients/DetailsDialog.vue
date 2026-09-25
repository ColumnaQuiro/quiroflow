<script setup lang="ts">
// The patient's full administrative record -- fourteen fields, plus the
// communication preferences that govern what the app is allowed to send.
//
// It used to be the second thing on Overview, which meant the default tab of
// every patient open led with an address and a referral source. Those are
// answers to "who is this on paper", asked when someone is correcting a
// typo or chasing an insurer -- not when a practitioner is about to see a
// patient in four minutes. So the record moved into a dialog behind one
// button, and Overview kept the six fields worth glancing at.
//
// Nothing about the form itself changed: same fields, same validation, same
// save, same referral-campaign side effect. It is lifted, not rewritten.
import { formatEur } from '~/utils/billing'
import type { Tables } from '~/types/database.types'
import { normalizeSearchTerm } from '~/utils/searchText'

const props = defineProps<{ patient: Tables<'patients'> }>()
const emit = defineEmits<{ updated: []; close: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const { can } = usePermission()
const { load: loadPackageTags, isPackageTag } = usePackageTags()
onMounted(loadPackageTags)

interface TeamMemberOption { id: string; full_name: string }
interface TutorOption { id: string; first_name: string; last_name: string | null }
const teamMembers = ref<TeamMemberOption[]>([])
const referralSources = ref<Tables<'referral_sources'>[]>([])
const tutorSearch = ref('')
const tutorResults = ref<TutorOption[]>([])
const selectedTutor = ref<TutorOption | null>(null)

// "Referred by" a specific patient -- same self-search pattern as tutor,
// shown only when referral_source is exactly the "Patient" option (seeded
// per-account by migration 0095; a display-string match, not a schema
// flag, so renaming that referral source would silently break this).
type ReferrerOption = TutorOption
const referredBySearch = ref('')
const referredByResults = ref<ReferrerOption[]>([])
const selectedReferredBy = ref<ReferrerOption | null>(null)
const referredPatients = ref<TutorOption[]>([])

async function loadReferredPatients() {
  const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('referred_by_patient_id', props.patient.id)
  referredPatients.value = data ?? []
}

onMounted(async () => {
  const [{ data: members }, { data: sources }] = await Promise.all([
    supabase.from('team_members').select('id, full_name').order('full_name'),
    supabase.from('referral_sources').select('*').order('name'),
  ])
  teamMembers.value = members ?? []
  referralSources.value = sources ?? []
  if (props.patient.tutor_patient_id) {
    const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('id', props.patient.tutor_patient_id).maybeSingle()
    if (data) selectedTutor.value = data
  }
  if (props.patient.referred_by_patient_id) {
    const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('id', props.patient.referred_by_patient_id).maybeSingle()
    if (data) selectedReferredBy.value = data
  }
  await loadReferredPatients()
})
watch(() => props.patient.id, loadReferredPatients)

let tutorDebounce: ReturnType<typeof setTimeout> | undefined
watch(tutorSearch, (value) => {
  clearTimeout(tutorDebounce)
  if (!value.trim()) {
    tutorResults.value = []
    return
  }
  tutorDebounce = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .neq('id', props.patient.id)
      .ilike('search_name', `%${normalizeSearchTerm(value.trim())}%`)
      .limit(8)
    tutorResults.value = data ?? []
  }, 250)
})
function pickTutor(t: TutorOption) {
  selectedTutor.value = t
  tutorSearch.value = ''
  tutorResults.value = []
}
function tutorName(t: TutorOption) {
  return `${t.first_name} ${t.last_name ?? ''}`.trim()
}

let referredByDebounce: ReturnType<typeof setTimeout> | undefined
watch(referredBySearch, (value) => {
  clearTimeout(referredByDebounce)
  if (!value.trim()) {
    referredByResults.value = []
    return
  }
  referredByDebounce = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .neq('id', props.patient.id)
      .ilike('search_name', `%${normalizeSearchTerm(value.trim())}%`)
      .limit(8)
    referredByResults.value = data ?? []
  }, 250)
})
function pickReferredBy(p: ReferrerOption) {
  selectedReferredBy.value = p
  referredBySearch.value = ''
  referredByResults.value = []
}

function teamMemberName(id: string | null) {
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? t('None', 'Ninguno')
}
function clinicName(id: string | null) {
  return store.clinics.find((c) => c.id === id)?.name ?? t('None', 'Ninguna')
}
function languageLabel(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code
}
function channelLabel(value: string) {
  return CHANNEL_OPTIONS.find((c) => c.value === value)?.label ?? value
}


// -- Details edit form -------------------------------------------------
const editing = ref(true)
const saving = ref(false)
const error = ref('')

const firstName = ref(props.patient.first_name)
const lastName = ref(props.patient.last_name ?? '')
const dateOfBirth = ref(props.patient.date_of_birth ?? '')
const email = ref(props.patient.email ?? '')
const address = ref(props.patient.address ?? '')
const postalCode = ref(props.patient.postal_code ?? '')
const city = ref(props.patient.city ?? '')
const country = ref(props.patient.country ?? '')
const nationalId = ref(props.patient.national_id ?? '')
const clinicId = ref(props.patient.clinic_id ?? '')
const tagsInput = ref(props.patient.tags.join(', '))
const occupation = ref(props.patient.occupation ?? '')
const emergencyContact = ref(props.patient.emergency_contact ?? '')
const referralSource = ref(props.patient.referral_source ?? '')
const preferredLanguage = ref(props.patient.preferred_language)
const defaultPractitionerId = ref(props.patient.default_practitioner_id ?? '')
const invoiceEmailEnabled = ref(props.patient.invoice_email_enabled)
const reminderChannel = ref(props.patient.reminder_channel)
const confirmationChannel = ref(props.patient.confirmation_channel)
const marketingChannels = ref<string[]>([...props.patient.marketing_channels])
const status = ref(props.patient.status)
const isMinor = ref(props.patient.is_minor)
const doNotContact = ref(props.patient.do_not_contact)

async function startEditing() {
  firstName.value = props.patient.first_name
  lastName.value = props.patient.last_name ?? ''
  dateOfBirth.value = props.patient.date_of_birth ?? ''
  email.value = props.patient.email ?? ''
  address.value = props.patient.address ?? ''
  postalCode.value = props.patient.postal_code ?? ''
  city.value = props.patient.city ?? ''
  country.value = props.patient.country ?? ''
  nationalId.value = props.patient.national_id ?? ''
  clinicId.value = props.patient.clinic_id ?? ''
  tagsInput.value = props.patient.tags.join(', ')
  occupation.value = props.patient.occupation ?? ''
  emergencyContact.value = props.patient.emergency_contact ?? ''
  referralSource.value = props.patient.referral_source ?? ''
  preferredLanguage.value = props.patient.preferred_language
  defaultPractitionerId.value = props.patient.default_practitioner_id ?? ''
  invoiceEmailEnabled.value = props.patient.invoice_email_enabled
  reminderChannel.value = props.patient.reminder_channel
  confirmationChannel.value = props.patient.confirmation_channel
  marketingChannels.value = [...props.patient.marketing_channels]
  status.value = props.patient.status
  isMinor.value = props.patient.is_minor
  doNotContact.value = props.patient.do_not_contact
  selectedTutor.value = null
  if (props.patient.tutor_patient_id) {
    const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('id', props.patient.tutor_patient_id).maybeSingle()
    if (data) selectedTutor.value = data
  }
  selectedReferredBy.value = null
  if (props.patient.referred_by_patient_id) {
    const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('id', props.patient.referred_by_patient_id).maybeSingle()
    if (data) selectedReferredBy.value = data
  }
  editing.value = true
}

const { fire } = useAutomations()

async function save() {
  error.value = ''
  saving.value = true
  const tags = tagsInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  // patients_tags_remove, said before the save rather than after the
  // database refuses the whole form over one tag.
  if (!can('patients_tags_remove')) {
    const kept = new Set(tags.map((x) => x.toLocaleLowerCase('es')))
    const lost = props.patient.tags.filter((x) => isPackageTag(x) && !kept.has(x.trim().toLocaleLowerCase('es')))
    if (lost.length > 0) {
      error.value = t(
        `Your role cannot remove bono or membership tags: ${lost.join(', ')}. Put them back to save.`,
        `Tu rol no puede quitar etiquetas de bono o membresía: ${lost.join(', ')}. Vuelve a ponerlas para guardar.`,
      )
      saving.value = false
      return
    }
  }

  const newReferredById = referralSource.value === 'Patient' ? (selectedReferredBy.value?.id ?? null) : null

  const { error: updateError } = await supabase
    .from('patients')
    .update({
      first_name: firstName.value,
      last_name: lastName.value || null,
      date_of_birth: dateOfBirth.value || null,
      email: email.value || null,
      address: address.value || null,
      postal_code: postalCode.value || null,
      city: city.value || null,
      country: country.value || null,
      national_id: nationalId.value || null,
      clinic_id: clinicId.value || null,
      tags,
      occupation: occupation.value || null,
      emergency_contact: emergencyContact.value || null,
      referral_source: referralSource.value || null,
      preferred_language: preferredLanguage.value,
      default_practitioner_id: defaultPractitionerId.value || null,
      invoice_email_enabled: invoiceEmailEnabled.value,
      reminder_channel: reminderChannel.value,
      confirmation_channel: confirmationChannel.value,
      marketing_channels: marketingChannels.value,
      status: status.value,
      is_minor: isMinor.value,
      do_not_contact: doNotContact.value,
      tutor_patient_id: isMinor.value ? (selectedTutor.value?.id ?? null) : null,
      referred_by_patient_id: newReferredById,
    })
    .eq('id', props.patient.id)

  saving.value = false
  if (updateError) {
    error.value = updateError.message
    showToast(updateError.message, 'error')
    return
  }
  showToast(t('Patient saved', 'Paciente guardado'))
  // Fires for the REFERRER, not this patient -- only on the transition into
  // a newly-linked referrer, so re-saving the form without touching this
  // field (or clearing it) never re-fires the thank-you campaign.
  if (newReferredById && newReferredById !== props.patient.referred_by_patient_id) {
    fire('patient.referred', { patientId: newReferredById })
  }
  emit('updated')
  emit('close')
}

const inputClass = 'mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none'
const labelClass = 'block text-[12px] font-medium text-ink-muted'
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 p-0 lg:items-start lg:overflow-y-auto lg:p-8"
    @click.self="emit('close')"
  >
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="t('Patient details', 'Datos del paciente')"
      class="max-h-[92vh] w-full overflow-y-auto rounded-t-card bg-surface-page lg:max-w-[900px] lg:rounded-card"
    >
      <div class="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface-page px-4 py-3 lg:px-5">
        <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Patient details', 'Datos del paciente') }}</h2>
        <button
          type="button"
          :aria-label="t('Close', 'Cerrar')"
          class="flex h-9 w-9 items-center justify-center rounded-ctl text-ink-muted outline-none hover:bg-surface-subtle hover:text-ink-700 focus-visible:shadow-focus"
          @click="emit('close')"
        >
          <svg viewBox="0 0 14 14" aria-hidden="true" class="h-3.5 w-3.5">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 p-4 lg:p-5">
    <!-- Patient details -->
    <div class="rounded-card border border-line bg-surface p-5 shadow-card">
      <div class="flex items-center justify-between">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Patient details', 'Datos del paciente') }}</p>
        <UiIconBtn v-if="!editing" icon="pencil" :label="t('Edit', 'Editar')" @click="startEditing" />
      </div>

      <!-- Phone numbers are a separate one-to-many table (patient_contact_numbers),
           not a scalar field on `patients` -- it manages its own add/remove and
           saves immediately (no Save button), but the add/remove controls are only
           shown while editing, matching every other field on this card. -->
      <div class="mt-4 border-b border-line-divider pb-4">
        <PatientsContactNumbersEditor :patient-id="patient.id" :editable="editing" />
      </div>

      <dl v-if="!editing" class="mt-4 grid grid-cols-3 gap-x-6 gap-y-4">
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Date of birth', 'Fecha de nacimiento') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.date_of_birth ?? t('N/A', 'N/D') }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Email', 'Correo electrónico') }}</dt>
          <dd class="mt-0.5 truncate text-[13.5px] text-ink-700">{{ patient.email ?? t('N/A', 'N/D') }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Address', 'Dirección') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            <p class="truncate">{{ patient.address ?? t('N/A', 'N/D') }}</p>
            <p v-if="patient.city || patient.postal_code || patient.country" class="truncate text-ink-muted">
              {{ [patient.postal_code, patient.city].filter(Boolean).join(' ') }}{{ patient.country ? (patient.city || patient.postal_code ? ', ' : '') + patient.country : '' }}
            </p>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('National ID', 'DNI/NIE') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.national_id ?? t('N/A', 'N/D') }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Occupation', 'Profesión') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.occupation ?? t('N/A', 'N/D') }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Emergency contact', 'Contacto de emergencia') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.emergency_contact ?? t('N/A', 'N/D') }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Referral source', 'Origen de la referencia') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            {{ patient.referral_source ?? t('N/A', 'N/D') }}
            <template v-if="patient.referral_source === 'Patient'">
              &middot;
              <NuxtLink v-if="patient.referred_by_patient_id" :to="`/patients/${patient.referred_by_patient_id}`" class="text-brand-text hover:underline">
                {{ selectedReferredBy ? tutorName(selectedReferredBy) : t('View patient', 'Ver paciente') }}
              </NuxtLink>
              <span v-else class="text-danger-text">{{ t('No patient linked', 'Ningún paciente vinculado') }}</span>
            </template>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Preferred language', 'Idioma preferido') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ languageLabel(patient.preferred_language) }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Default practitioner', 'Profesional predeterminado') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ teamMemberName(patient.default_practitioner_id) }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Clinic', 'Clínica') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ clinicName(patient.clinic_id) }}</dd>
        </div>
        <div class="col-span-2">
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Tags', 'Etiquetas') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            <span v-if="patient.tags.length === 0">{{ t('None', 'Ninguna') }}</span>
            <span v-for="tag in patient.tags" :key="tag" class="mr-1 inline-block rounded-pill bg-chip-bg px-2 py-0.5 text-[11px] font-medium text-chip-text">
              {{ tag }}
            </span>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Status', 'Estado') }}</dt>
          <dd class="mt-0.5"><UiPill :tone="patient.status === 'active' ? 'success' : 'neutral'">{{ patient.status === 'active' ? t('Active', 'Activo') : t('Inactive', 'Inactivo') }}</UiPill></dd>
        </div>
        <div v-if="patient.is_minor">
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Tutor', 'Tutor') }}</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            <NuxtLink v-if="patient.tutor_patient_id" :to="`/patients/${patient.tutor_patient_id}`" class="text-brand-text hover:underline">
              {{ selectedTutor ? tutorName(selectedTutor) : t('View tutor', 'Ver tutor') }}
            </NuxtLink>
            <span v-else class="text-danger-text">{{ t('No tutor linked', 'Ningún tutor vinculado') }}</span>
          </dd>
        </div>
        <div v-if="referredPatients.length > 0">
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Referred patients', 'Pacientes referidos') }}</dt>
          <dd class="mt-0.5 flex flex-wrap gap-x-2 text-[13.5px] text-ink-700">
            <NuxtLink v-for="r in referredPatients" :key="r.id" :to="`/patients/${r.id}`" class="text-brand-text hover:underline">{{ tutorName(r) }}</NuxtLink>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">{{ t('Communication flags', 'Alertas de comunicación') }}</dt>
          <dd class="mt-0.5 flex flex-wrap gap-1">
            <UiPill v-if="patient.is_minor" tone="brand">{{ t('Under age — no communications', 'Menor de edad — sin comunicaciones') }}</UiPill>
            <UiPill v-if="patient.do_not_contact" tone="danger">{{ t('Do not contact', 'No contactar') }}</UiPill>
            <span v-if="!patient.is_minor && !patient.do_not_contact" class="text-[13.5px] text-ink-700">{{ t('None', 'Ninguna') }}</span>
          </dd>
        </div>
      </dl>

      <form v-else class="mt-4 space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label :class="labelClass">{{ t('First name', 'Nombre') }}</label>
            <input v-model="firstName" type="text" required :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Last name', 'Apellidos') }}</label>
            <input v-model="lastName" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Date of birth', 'Fecha de nacimiento') }}</label>
            <input v-model="dateOfBirth" type="date" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Email', 'Correo electrónico') }}</label>
            <input v-model="email" type="email" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Street address', 'Dirección') }}</label>
            <input v-model="address" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Postal code', 'Código postal') }}</label>
            <input v-model="postalCode" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('City', 'Ciudad') }}</label>
            <input v-model="city" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Country', 'País') }}</label>
            <input v-model="country" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('National ID', 'DNI/NIE') }}</label>
            <input v-model="nationalId" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Occupation', 'Profesión') }}</label>
            <input v-model="occupation" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Emergency contact', 'Contacto de emergencia') }}</label>
            <input v-model="emergencyContact" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Referral source', 'Origen de la referencia') }}</label>
            <select v-model="referralSource" :class="inputClass">
              <option value="">{{ t('Not set', 'Sin especificar') }}</option>
              <option v-for="s in referralSources" :key="s.id" :value="s.name">{{ s.name }}</option>
              <!-- Preserves legacy freeform data that doesn't match a configured source. -->
              <option v-if="referralSource && !referralSources.some((s) => s.name === referralSource)" :value="referralSource">{{ referralSource }}</option>
            </select>
            <div v-if="referralSource === 'Patient'" class="mt-2">
              <label :class="labelClass">{{ t('Referred by (existing patient)', 'Referido por (paciente existente)') }}</label>
              <div v-if="selectedReferredBy" class="mt-1 flex items-center gap-2">
                <span class="text-[13px] text-ink-700">{{ tutorName(selectedReferredBy) }}</span>
                <button type="button" class="text-[12px] text-danger-text hover:underline" @click="selectedReferredBy = null">{{ t('Remove', 'Quitar') }}</button>
              </div>
              <div v-else class="relative mt-1">
                <input v-model="referredBySearch" type="text" :placeholder="t('Search patient by name…', 'Buscar paciente por nombre…')" :class="inputClass" />
                <ul v-if="referredByResults.length > 0" class="absolute z-10 mt-1 w-full rounded-ctl border border-line bg-surface py-1 shadow-popover">
                  <li v-for="p in referredByResults" :key="p.id">
                    <button type="button" class="block w-full px-3 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle" @click="pickReferredBy(p)">
                      {{ tutorName(p) }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div>
            <label :class="labelClass">{{ t('Preferred language', 'Idioma preferido') }}</label>
            <select v-model="preferredLanguage" :class="inputClass">
              <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option>
            </select>
          </div>
          <div>
            <label :class="labelClass">{{ t('Default practitioner', 'Profesional predeterminado') }}</label>
            <select v-model="defaultPractitionerId" :class="inputClass">
              <option value="">{{ t('None', 'Ninguno') }}</option>
              <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
          <div>
            <label :class="labelClass">{{ t('Clinic', 'Clínica') }}</label>
            <select v-model="clinicId" :class="inputClass">
              <option value="">{{ t('No primary clinic', 'Sin clínica principal') }}</option>
              <option v-for="clinic in store.clinics" :key="clinic.id" :value="clinic.id">{{ clinic.name }}</option>
            </select>
          </div>
          <div class="col-span-3">
            <label :class="labelClass">{{ t('Tags', 'Etiquetas') }}</label>
            <input v-model="tagsInput" type="text" :placeholder="t('comma, separated, tags', 'etiquetas, separadas, por, comas')" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">{{ t('Status', 'Estado') }}</label>
            <select v-model="status" :class="inputClass">
              <option value="active">{{ t('Active', 'Activo') }}</option>
              <option value="inactive">{{ t('Inactive', 'Inactivo') }}</option>
            </select>
          </div>
        </div>

        <div class="border-t border-line-divider pt-4">
          <p class="text-[13px] font-semibold text-ink-700">{{ t('Under age & do not contact', 'Menor de edad y no contactar') }}</p>
          <label class="mt-3 flex items-center gap-1.5 text-[13px] text-ink-600">
            <input v-model="isMinor" type="checkbox" class="rounded border-line-control text-brand focus:ring-brand" />
            {{ t('This patient is under age', 'Este paciente es menor de edad') }}
          </label>
          <div v-if="isMinor" class="mt-2.5 pl-5">
            <label :class="labelClass">{{ t('Tutor (parent / guardian, must be an existing patient)', 'Tutor (padre/madre o tutor legal, debe ser un paciente existente)') }}</label>
            <div v-if="selectedTutor" class="mt-1 flex items-center gap-2">
              <span class="text-[13px] text-ink-700">{{ tutorName(selectedTutor) }}</span>
              <button type="button" class="text-[12px] text-danger-text hover:underline" @click="selectedTutor = null">{{ t('Remove', 'Quitar') }}</button>
            </div>
            <div v-else class="relative mt-1">
              <input v-model="tutorSearch" type="text" :placeholder="t('Search patient by name…', 'Buscar paciente por nombre…')" :class="inputClass" />
              <ul v-if="tutorResults.length > 0" class="absolute z-10 mt-1 w-full rounded-ctl border border-line bg-surface py-1 shadow-popover">
                <li v-for="t in tutorResults" :key="t.id">
                  <button type="button" class="block w-full px-3 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle" @click="pickTutor(t)">
                    {{ tutorName(t) }}
                  </button>
                </li>
              </ul>
            </div>
            <p class="mt-1 text-[11px] text-ink-muted2">{{ t('While marked under age, no WhatsApp or email communications will be sent to this patient.', 'Mientras esté marcado como menor de edad, no se enviarán comunicaciones por WhatsApp o correo electrónico a este paciente.') }}</p>
          </div>
          <label class="mt-3 flex items-center gap-1.5 text-[13px] text-ink-600">
            <input v-model="doNotContact" type="checkbox" class="rounded border-line-control text-brand focus:ring-brand" />
            {{ t('Do not contact (blocks all communications and recalls)', 'No contactar (bloquea todas las comunicaciones y recordatorios)') }}
          </label>
        </div>

        <div class="border-t border-line-divider pt-4">
          <p class="text-[13px] font-semibold text-ink-700">{{ t('Communication preferences', 'Preferencias de comunicación') }}</p>

          <div class="mt-3">
            <label :class="labelClass">{{ t('Marketing channels', 'Canales de marketing') }}</label>
            <div class="mt-1.5 flex flex-wrap gap-4">
              <label v-for="opt in MARKETING_CHANNEL_OPTIONS" :key="opt.value" class="flex items-center gap-1.5 text-[13px] text-ink-600">
                <input v-model="marketingChannels" type="checkbox" :value="opt.value" class="rounded border-line-control text-brand focus:ring-brand" />
                {{ opt.label }}
              </label>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label :class="labelClass">{{ t('Reminder type', 'Tipo de recordatorio') }}</label>
              <select v-model="reminderChannel" :class="inputClass">
                <option v-for="opt in CHANNEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div>
              <label :class="labelClass">{{ t('Confirmation type', 'Tipo de confirmación') }}</label>
              <select v-model="confirmationChannel" :class="inputClass">
                <option v-for="opt in CHANNEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>

          <label class="mt-3 flex items-center gap-1.5 text-[13px] text-ink-600">
            <input v-model="invoiceEmailEnabled" type="checkbox" class="rounded border-line-control text-brand focus:ring-brand" />
            {{ t('Email receipt when an appointment is processed', 'Enviar recibo por correo al procesar una cita') }}
          </label>
        </div>

        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
        <div class="flex gap-2">
          <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
          <UiBtn type="button" variant="ghost" @click="editing = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        </div>
      </form>
    </div>

    <div v-if="!editing" class="grid grid-cols-2 gap-4">
      <div class="rounded-card border border-line bg-surface p-5 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Communication preferences', 'Preferencias de comunicación') }}</p>
        <div class="mt-3 space-y-2.5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">{{ t('Reminders', 'Recordatorios') }}</span>
            <UiPill tone="neutral">{{ channelLabel(patient.reminder_channel) }}</UiPill>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">{{ t('Confirmations', 'Confirmaciones') }}</span>
            <UiPill tone="neutral">{{ channelLabel(patient.confirmation_channel) }}</UiPill>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">{{ t('Receipt email', 'Recibo por correo') }}</span>
            <UiPill :tone="patient.invoice_email_enabled ? 'success' : 'neutral'">{{ patient.invoice_email_enabled ? t('Enabled', 'Activado') : t('Disabled', 'Desactivado') }}</UiPill>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">{{ t('Marketing', 'Marketing') }}</span>
            <div class="flex flex-wrap justify-end gap-1">
              <UiPill v-if="patient.marketing_channels.length === 0" tone="neutral">{{ t('None', 'Ninguno') }}</UiPill>
              <UiPill v-for="ch in patient.marketing_channels" :key="ch" tone="brand">{{ channelLabel(ch) }}</UiPill>
            </div>
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
