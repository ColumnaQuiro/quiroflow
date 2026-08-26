<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { normalizeSearchTerm } from '~/utils/searchText'

const props = defineProps<{ patient: Tables<'patients'> }>()
const emit = defineEmits<{ updated: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

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
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? 'None'
}
function clinicName(id: string | null) {
  return store.clinics.find((c) => c.id === id)?.name ?? 'None'
}
function languageLabel(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code
}
function channelLabel(value: string) {
  return CHANNEL_OPTIONS.find((c) => c.value === value)?.label ?? value
}

// -- KPI strip ------------------------------------------------------------
const kpiLoading = ref(true)
const visits12mo = ref(0)
const attendancePct = ref<number | null>(null)
const lastVisit = ref<string | null>(null)
const lifetimeCents = ref(0)

async function loadKpis() {
  kpiLoading.value = true
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  const [{ data: appts }, { data: invoices }] = await Promise.all([
    supabase.from('appointments').select('status, starts_at').eq('patient_id', props.patient.id),
    supabase.from('invoices').select('id').eq('patient_id', props.patient.id).neq('status', 'void'),
  ])

  visits12mo.value = (appts ?? []).filter((a) => a.status === 'completed' && a.starts_at >= oneYearAgo.toISOString()).length

  const completed = (appts ?? []).filter((a) => a.status === 'completed')
  const noShow = (appts ?? []).filter((a) => a.status === 'no_show')
  const denom = completed.length + noShow.length
  attendancePct.value = denom === 0 ? null : Math.round((completed.length / denom) * 100)

  const pastCompleted = completed.slice().sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  lastVisit.value = pastCompleted[0]?.starts_at ?? null

  const invoiceIds = (invoices ?? []).map((i) => i.id)
  if (invoiceIds.length > 0) {
    const { data: payments } = await supabase.from('payments').select('amount_cents').in('invoice_id', invoiceIds)
    lifetimeCents.value = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  } else {
    lifetimeCents.value = 0
  }
  kpiLoading.value = false
}
onMounted(loadKpis)
watch(() => props.patient.id, loadKpis)

function money(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}

// -- Recent activity -------------------------------------------------------
interface ActivityItem { at: string; text: string; dot: string }
const activity = ref<ActivityItem[]>([])
const activityLoading = ref(true)

async function loadActivity() {
  activityLoading.value = true
  const [{ data: appts }, { data: invoices }, { data: messages }] = await Promise.all([
    supabase
      .from('appointments')
      .select('starts_at, status, appointment_types(name)')
      .eq('patient_id', props.patient.id)
      .order('starts_at', { ascending: false })
      .limit(3),
    supabase.from('invoices').select('created_at, invoice_number, status').eq('patient_id', props.patient.id).order('created_at', { ascending: false }).limit(2),
    supabase.from('whatsapp_messages').select('created_at, direction, status').eq('patient_id', props.patient.id).order('created_at', { ascending: false }).limit(2),
  ])

  const items: ActivityItem[] = []
  for (const a of (appts as any[]) ?? []) {
    const typeName = a.appointment_types?.name ?? 'Visit'
    const verb = a.status === 'completed' ? 'Completed' : a.status === 'cancelled' ? 'Cancelled' : a.status === 'no_show' ? 'Missed' : 'Booked'
    items.push({ at: a.starts_at, text: `${verb} ${typeName.toLowerCase()} appointment`, dot: a.status === 'completed' ? 'bg-success-accent' : a.status === 'no_show' || a.status === 'cancelled' ? 'bg-warning-accent' : 'bg-brand' })
  }
  for (const inv of invoices ?? []) {
    items.push({ at: inv.created_at, text: `Invoice ${inv.invoice_number} ${inv.status === 'paid' ? 'paid' : 'issued'}`, dot: inv.status === 'paid' ? 'bg-success-accent' : 'bg-ink-faint3' })
  }
  for (const m of messages ?? []) {
    items.push({ at: m.created_at, text: m.direction === 'inbound' ? 'Replied via WhatsApp' : 'WhatsApp message sent', dot: 'bg-brand' })
  }
  items.sort((a, b) => b.at.localeCompare(a.at))
  activity.value = items.slice(0, 6)
  activityLoading.value = false
}
onMounted(loadActivity)
watch(() => props.patient.id, loadActivity)

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays === -1) return 'Tomorrow'
  if (diffDays > 0 && diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 0 && diffDays > -7) return `in ${-diffDays}d`
  if (diffDays >= 7 && diffDays < 60) return `${Math.round(diffDays / 7)}w ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// -- Details edit form -------------------------------------------------
const editing = ref(false)
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

async function save() {
  error.value = ''
  saving.value = true
  const tags = tagsInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

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
      referred_by_patient_id: referralSource.value === 'Patient' ? (selectedReferredBy.value?.id ?? null) : null,
    })
    .eq('id', props.patient.id)

  saving.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  editing.value = false
  emit('updated')
}

const inputClass = 'mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none'
const labelClass = 'block text-[12px] font-medium text-ink-muted'
</script>

<template>
  <div class="space-y-4">
    <!-- KPI strip -->
    <div class="grid grid-cols-4 gap-3">
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Visits, 12 mo</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900">{{ kpiLoading ? '—' : visits12mo }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Attendance</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900">{{ kpiLoading || attendancePct === null ? '—' : `${attendancePct}%` }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Last visit</p>
        <p class="mt-1 text-[20px] font-semibold text-ink-900">
          {{ kpiLoading ? '—' : lastVisit ? new Date(lastVisit).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—' }}
        </p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[11.5px] text-ink-muted2">Lifetime value</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900">{{ kpiLoading ? '—' : money(lifetimeCents) }}</p>
      </div>
    </div>

    <!-- Patient details -->
    <div class="rounded-card border border-line bg-surface p-5 shadow-card">
      <div class="flex items-center justify-between">
        <p class="text-[13.5px] font-semibold text-ink-700">Patient details</p>
        <UiBtn v-if="!editing" variant="secondary" size="sm" @click="startEditing">Edit</UiBtn>
      </div>

      <dl v-if="!editing" class="mt-4 grid grid-cols-3 gap-x-6 gap-y-4">
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Date of birth</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.date_of_birth ?? 'N/A' }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Email</dt>
          <dd class="mt-0.5 truncate text-[13.5px] text-ink-700">{{ patient.email ?? 'N/A' }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Address</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            <p class="truncate">{{ patient.address ?? 'N/A' }}</p>
            <p v-if="patient.city || patient.postal_code || patient.country" class="truncate text-ink-muted">
              {{ [patient.postal_code, patient.city].filter(Boolean).join(' ') }}{{ patient.country ? (patient.city || patient.postal_code ? ', ' : '') + patient.country : '' }}
            </p>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">National ID</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.national_id ?? 'N/A' }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Occupation</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.occupation ?? 'N/A' }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Emergency contact</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ patient.emergency_contact ?? 'N/A' }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Referral source</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            {{ patient.referral_source ?? 'N/A' }}
            <template v-if="patient.referral_source === 'Patient'">
              &middot;
              <NuxtLink v-if="patient.referred_by_patient_id" :to="`/patients/${patient.referred_by_patient_id}`" class="text-brand-text hover:underline">
                {{ selectedReferredBy ? tutorName(selectedReferredBy) : 'View patient' }}
              </NuxtLink>
              <span v-else class="text-danger-text">No patient linked</span>
            </template>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Preferred language</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ languageLabel(patient.preferred_language) }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Default practitioner</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ teamMemberName(patient.default_practitioner_id) }}</dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Clinic</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">{{ clinicName(patient.clinic_id) }}</dd>
        </div>
        <div class="col-span-2">
          <dt class="text-[11.5px] text-ink-muted2">Tags</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            <span v-if="patient.tags.length === 0">None</span>
            <span v-for="tag in patient.tags" :key="tag" class="mr-1 inline-block rounded-pill bg-chip-bg px-2 py-0.5 text-[11px] font-medium text-chip-text">
              {{ tag }}
            </span>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Status</dt>
          <dd class="mt-0.5"><UiPill :tone="patient.status === 'active' ? 'success' : 'neutral'">{{ patient.status === 'active' ? 'Active' : 'Inactive' }}</UiPill></dd>
        </div>
        <div v-if="patient.is_minor">
          <dt class="text-[11.5px] text-ink-muted2">Tutor</dt>
          <dd class="mt-0.5 text-[13.5px] text-ink-700">
            <NuxtLink v-if="patient.tutor_patient_id" :to="`/patients/${patient.tutor_patient_id}`" class="text-brand-text hover:underline">
              {{ selectedTutor ? tutorName(selectedTutor) : 'View tutor' }}
            </NuxtLink>
            <span v-else class="text-danger-text">No tutor linked</span>
          </dd>
        </div>
        <div v-if="referredPatients.length > 0">
          <dt class="text-[11.5px] text-ink-muted2">Referred patients</dt>
          <dd class="mt-0.5 flex flex-wrap gap-x-2 text-[13.5px] text-ink-700">
            <NuxtLink v-for="r in referredPatients" :key="r.id" :to="`/patients/${r.id}`" class="text-brand-text hover:underline">{{ tutorName(r) }}</NuxtLink>
          </dd>
        </div>
        <div>
          <dt class="text-[11.5px] text-ink-muted2">Communication flags</dt>
          <dd class="mt-0.5 flex flex-wrap gap-1">
            <UiPill v-if="patient.is_minor" tone="brand">Under age — no communications</UiPill>
            <UiPill v-if="patient.do_not_contact" tone="danger">Do not contact</UiPill>
            <span v-if="!patient.is_minor && !patient.do_not_contact" class="text-[13.5px] text-ink-700">None</span>
          </dd>
        </div>
      </dl>

      <form v-else class="mt-4 space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label :class="labelClass">First name</label>
            <input v-model="firstName" type="text" required :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Last name</label>
            <input v-model="lastName" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Date of birth</label>
            <input v-model="dateOfBirth" type="date" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Email</label>
            <input v-model="email" type="email" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Street address</label>
            <input v-model="address" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Postal code</label>
            <input v-model="postalCode" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">City</label>
            <input v-model="city" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Country</label>
            <input v-model="country" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">National ID</label>
            <input v-model="nationalId" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Occupation</label>
            <input v-model="occupation" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Emergency contact</label>
            <input v-model="emergencyContact" type="text" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Referral source</label>
            <select v-model="referralSource" :class="inputClass">
              <option value="">Not set</option>
              <option v-for="s in referralSources" :key="s.id" :value="s.name">{{ s.name }}</option>
              <!-- Preserves legacy freeform data that doesn't match a configured source. -->
              <option v-if="referralSource && !referralSources.some((s) => s.name === referralSource)" :value="referralSource">{{ referralSource }}</option>
            </select>
            <div v-if="referralSource === 'Patient'" class="mt-2">
              <label :class="labelClass">Referred by (existing patient)</label>
              <div v-if="selectedReferredBy" class="mt-1 flex items-center gap-2">
                <span class="text-[13px] text-ink-700">{{ tutorName(selectedReferredBy) }}</span>
                <button type="button" class="text-[12px] text-danger-text hover:underline" @click="selectedReferredBy = null">Remove</button>
              </div>
              <div v-else class="relative mt-1">
                <input v-model="referredBySearch" type="text" placeholder="Search patient by name…" :class="inputClass" />
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
            <label :class="labelClass">Preferred language</label>
            <select v-model="preferredLanguage" :class="inputClass">
              <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option>
            </select>
          </div>
          <div>
            <label :class="labelClass">Default practitioner</label>
            <select v-model="defaultPractitionerId" :class="inputClass">
              <option value="">None</option>
              <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
          <div>
            <label :class="labelClass">Clinic</label>
            <select v-model="clinicId" :class="inputClass">
              <option value="">No primary clinic</option>
              <option v-for="clinic in store.clinics" :key="clinic.id" :value="clinic.id">{{ clinic.name }}</option>
            </select>
          </div>
          <div class="col-span-3">
            <label :class="labelClass">Tags</label>
            <input v-model="tagsInput" type="text" placeholder="comma, separated, tags" :class="inputClass" />
          </div>
          <div>
            <label :class="labelClass">Status</label>
            <select v-model="status" :class="inputClass">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div class="border-t border-line-divider pt-4">
          <p class="text-[13px] font-semibold text-ink-700">Under age &amp; do not contact</p>
          <label class="mt-3 flex items-center gap-1.5 text-[13px] text-ink-600">
            <input v-model="isMinor" type="checkbox" class="rounded border-line-control text-brand focus:ring-brand" />
            This patient is under age
          </label>
          <div v-if="isMinor" class="mt-2.5 pl-5">
            <label :class="labelClass">Tutor (parent / guardian, must be an existing patient)</label>
            <div v-if="selectedTutor" class="mt-1 flex items-center gap-2">
              <span class="text-[13px] text-ink-700">{{ tutorName(selectedTutor) }}</span>
              <button type="button" class="text-[12px] text-danger-text hover:underline" @click="selectedTutor = null">Remove</button>
            </div>
            <div v-else class="relative mt-1">
              <input v-model="tutorSearch" type="text" placeholder="Search patient by name…" :class="inputClass" />
              <ul v-if="tutorResults.length > 0" class="absolute z-10 mt-1 w-full rounded-ctl border border-line bg-surface py-1 shadow-popover">
                <li v-for="t in tutorResults" :key="t.id">
                  <button type="button" class="block w-full px-3 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle" @click="pickTutor(t)">
                    {{ tutorName(t) }}
                  </button>
                </li>
              </ul>
            </div>
            <p class="mt-1 text-[11px] text-ink-muted2">While marked under age, no WhatsApp or email communications will be sent to this patient.</p>
          </div>
          <label class="mt-3 flex items-center gap-1.5 text-[13px] text-ink-600">
            <input v-model="doNotContact" type="checkbox" class="rounded border-line-control text-brand focus:ring-brand" />
            Do not contact (blocks all communications and recalls)
          </label>
        </div>

        <div class="border-t border-line-divider pt-4">
          <p class="text-[13px] font-semibold text-ink-700">Communication preferences</p>

          <div class="mt-3">
            <label :class="labelClass">Marketing channels</label>
            <div class="mt-1.5 flex flex-wrap gap-4">
              <label v-for="opt in MARKETING_CHANNEL_OPTIONS" :key="opt.value" class="flex items-center gap-1.5 text-[13px] text-ink-600">
                <input v-model="marketingChannels" type="checkbox" :value="opt.value" class="rounded border-line-control text-brand focus:ring-brand" />
                {{ opt.label }}
              </label>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label :class="labelClass">Reminder type</label>
              <select v-model="reminderChannel" :class="inputClass">
                <option v-for="opt in CHANNEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div>
              <label :class="labelClass">Confirmation type</label>
              <select v-model="confirmationChannel" :class="inputClass">
                <option v-for="opt in CHANNEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>

          <label class="mt-3 flex items-center gap-1.5 text-[13px] text-ink-600">
            <input v-model="invoiceEmailEnabled" type="checkbox" class="rounded border-line-control text-brand focus:ring-brand" />
            Email invoice when an appointment is processed
          </label>
        </div>

        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
        <div class="flex gap-2">
          <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</UiBtn>
          <UiBtn type="button" variant="ghost" @click="editing = false">Cancel</UiBtn>
        </div>
      </form>
    </div>

    <div v-if="!editing" class="grid grid-cols-2 gap-4">
      <div class="rounded-card border border-line bg-surface p-5 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">Communication preferences</p>
        <div class="mt-3 space-y-2.5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">Reminders</span>
            <UiPill tone="neutral">{{ channelLabel(patient.reminder_channel) }}</UiPill>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">Confirmations</span>
            <UiPill tone="neutral">{{ channelLabel(patient.confirmation_channel) }}</UiPill>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">Invoice email</span>
            <UiPill :tone="patient.invoice_email_enabled ? 'success' : 'neutral'">{{ patient.invoice_email_enabled ? 'Enabled' : 'Disabled' }}</UiPill>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="text-[12.5px] text-ink-muted">Marketing</span>
            <div class="flex flex-wrap justify-end gap-1">
              <UiPill v-if="patient.marketing_channels.length === 0" tone="neutral">None</UiPill>
              <UiPill v-for="ch in patient.marketing_channels" :key="ch" tone="brand">{{ channelLabel(ch) }}</UiPill>
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-card border border-line bg-surface p-5 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">Recent activity</p>
        <div v-if="activityLoading" class="mt-3 text-[12.5px] text-ink-faint">Loading…</div>
        <p v-else-if="activity.length === 0" class="mt-3 text-[12.5px] text-ink-faint">No recent activity.</p>
        <ul v-else class="mt-3 space-y-2.5">
          <li v-for="(item, i) in activity" :key="i" class="flex items-center gap-2.5">
            <span class="h-[6px] w-[6px] shrink-0 rounded-full" :class="item.dot" />
            <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink-600">{{ item.text }}</span>
            <span class="shrink-0 text-[11.5px] text-ink-faint">{{ relativeTime(item.at) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
