<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patient: Tables<'patients'> }>()
const emit = defineEmits<{ updated: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

const editing = ref(false)
const saving = ref(false)
const error = ref('')

const firstName = ref(props.patient.first_name)
const lastName = ref(props.patient.last_name ?? '')
const dateOfBirth = ref(props.patient.date_of_birth ?? '')
const email = ref(props.patient.email ?? '')
const phone = ref(props.patient.phone ?? '')
const clinicId = ref(props.patient.clinic_id ?? '')
const tagsInput = ref(props.patient.tags.join(', '))

function startEditing() {
  firstName.value = props.patient.first_name
  lastName.value = props.patient.last_name ?? ''
  dateOfBirth.value = props.patient.date_of_birth ?? ''
  email.value = props.patient.email ?? ''
  phone.value = props.patient.phone ?? ''
  clinicId.value = props.patient.clinic_id ?? ''
  tagsInput.value = props.patient.tags.join(', ')
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
      phone: phone.value || null,
      clinic_id: clinicId.value || null,
      tags,
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
  <div class="max-w-lg rounded-lg border border-gray-200 bg-white p-6">
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
        <dt class="text-gray-500">Phone</dt>
        <dd class="text-gray-900">{{ patient.phone ?? 'N/A' }}</dd>
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
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">Email</label>
          <input v-model="email" type="email" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Phone</label>
          <input v-model="phone" type="tel" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
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
</template>
