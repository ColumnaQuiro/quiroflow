<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patient: Tables<'patients'> }>()
const emit = defineEmits<{ updated: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

interface TeamMemberOption { id: string; full_name: string }
const teamMembers = ref<TeamMemberOption[]>([])
onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name').order('full_name')
  teamMembers.value = data ?? []
})

function teamMemberName(id: string | null) {
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? 'None'
}
function languageLabel(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code
}
function channelLabel(value: string) {
  return CHANNEL_OPTIONS.find((c) => c.value === value)?.label ?? value
}

const editing = ref(false)
const saving = ref(false)
const error = ref('')

const firstName = ref(props.patient.first_name)
const lastName = ref(props.patient.last_name ?? '')
const dateOfBirth = ref(props.patient.date_of_birth ?? '')
const email = ref(props.patient.email ?? '')
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

function startEditing() {
  firstName.value = props.patient.first_name
  lastName.value = props.patient.last_name ?? ''
  dateOfBirth.value = props.patient.date_of_birth ?? ''
  email.value = props.patient.email ?? ''
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
</script>

<template>
  <div class="max-w-lg space-y-6">
    <div class="rounded-lg border border-gray-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-900">Contact details</h2>
        <button
          v-if="!editing"
          type="button"
          class="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          @click="startEditing"
        >
          Edit
        </button>
      </div>

      <dl v-if="!editing" class="mt-4 space-y-3 text-sm">
        <div class="flex justify-between">
          <dt class="text-gray-500">Date of birth</dt>
          <dd class="text-gray-900">{{ patient.date_of_birth ?? 'N/A' }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Email</dt>
          <dd class="text-gray-900">{{ patient.email ?? 'N/A' }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Occupation</dt>
          <dd class="text-gray-900">{{ patient.occupation ?? 'N/A' }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Emergency contact</dt>
          <dd class="text-gray-900">{{ patient.emergency_contact ?? 'N/A' }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Referral source</dt>
          <dd class="text-gray-900">{{ patient.referral_source ?? 'N/A' }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Preferred language</dt>
          <dd class="text-gray-900">{{ languageLabel(patient.preferred_language) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Default practitioner</dt>
          <dd class="text-gray-900">{{ teamMemberName(patient.default_practitioner_id) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Tags</dt>
          <dd class="text-gray-900">
            <span v-if="patient.tags.length === 0">None</span>
            <span
              v-for="tag in patient.tags"
              :key="tag"
              class="ml-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 first:ml-0"
            >
              {{ tag }}
            </span>
          </dd>
        </div>
      </dl>

      <form v-else class="mt-4 space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">First name</label>
            <input v-model="firstName" type="text" required class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Last name</label>
            <input v-model="lastName" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Date of birth</label>
          <input v-model="dateOfBirth" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Email</label>
          <input v-model="email" type="email" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Occupation</label>
            <input v-model="occupation" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Emergency contact</label>
            <input v-model="emergencyContact" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Referral source</label>
          <input v-model="referralSource" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Preferred language</label>
            <select v-model="preferredLanguage" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Default practitioner</label>
            <select v-model="defaultPractitionerId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="">None</option>
              <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Clinic</label>
          <select v-model="clinicId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="">No primary clinic</option>
            <option v-for="clinic in store.clinics" :key="clinic.id" :value="clinic.id">{{ clinic.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Tags</label>
          <input v-model="tagsInput" type="text" placeholder="comma, separated, tags" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>

        <div class="border-t border-gray-100 pt-4">
          <h3 class="text-sm font-semibold text-gray-900">Communication preferences</h3>

          <div class="mt-3">
            <label class="block text-sm font-medium text-gray-700">Marketing channels</label>
            <div class="mt-1 flex flex-wrap gap-4">
              <label v-for="opt in MARKETING_CHANNEL_OPTIONS" :key="opt.value" class="flex items-center gap-1.5 text-sm text-gray-600">
                <input v-model="marketingChannels" type="checkbox" :value="opt.value" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                {{ opt.label }}
              </label>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700">Reminder type</label>
              <select v-model="reminderChannel" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option v-for="opt in CHANNEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Confirmation type</label>
              <select v-model="confirmationChannel" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option v-for="opt in CHANNEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>

          <label class="mt-3 flex items-center gap-1.5 text-sm text-gray-600">
            <input v-model="invoiceEmailEnabled" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            Email invoice when an appointment is processed
          </label>
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <div class="flex gap-3">
          <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="editing = false">
            Cancel
          </button>
        </div>
      </form>
    </div>

    <div v-if="!editing" class="rounded-lg border border-gray-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-gray-900">Communication preferences</h2>
      <dl class="mt-4 space-y-3 text-sm">
        <div class="flex justify-between">
          <dt class="text-gray-500">Marketing channels</dt>
          <dd class="text-gray-900">
            <span v-if="patient.marketing_channels.length === 0">None</span>
            <span
              v-for="ch in patient.marketing_channels"
              :key="ch"
              class="ml-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 first:ml-0"
            >
              {{ channelLabel(ch) }}
            </span>
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Reminder type</dt>
          <dd class="text-gray-900">{{ channelLabel(patient.reminder_channel) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Confirmation type</dt>
          <dd class="text-gray-900">{{ channelLabel(patient.confirmation_channel) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-gray-500">Invoice email</dt>
          <dd class="text-gray-900">{{ patient.invoice_email_enabled ? 'Enabled' : 'Disabled' }}</dd>
        </div>
      </dl>
    </div>

    <div class="rounded-lg border border-gray-200 bg-white p-6">
      <PatientsContactNumbersEditor :patient-id="patient.id" />
    </div>
  </div>
</template>
