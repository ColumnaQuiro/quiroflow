<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

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
const referralSource = ref('')
const error = ref('')
const saving = ref(false)

const referralSources = ref<Tables<'referral_sources'>[]>([])
onMounted(async () => {
  const { data } = await supabase.from('referral_sources').select('*').order('name')
  referralSources.value = data ?? []
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
      referral_source: referralSource.value || null,
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
  await navigateTo(`/patients/${data.id}`)
}
</script>

<template>
  <div class="max-w-lg">
    <h1 class="text-xl font-semibold text-gray-900">Add Patient</h1>

    <form class="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6" @submit.prevent="onSubmit">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700" for="first-name">First name</label>
          <input
            id="first-name"
            v-model="firstName"
            type="text"
            required
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700" for="last-name">Last name</label>
          <input
            id="last-name"
            v-model="lastName"
            type="text"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700" for="dob">Date of birth</label>
        <input
          id="dob"
          v-model="dateOfBirth"
          type="date"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div class="min-w-0">
          <label class="block text-sm font-medium text-gray-700">Phone</label>
          <div class="mt-1 flex gap-2">
            <select
              v-model="phoneCountry"
              class="shrink-0 rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }}</option>
            </select>
            <input
              v-model="phoneNumber"
              type="tel"
              placeholder="612 34 56 78"
              class="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <label class="mt-1.5 flex items-center gap-1.5 text-sm text-gray-600">
            <input v-model="phoneIsWhatsapp" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            This number has WhatsApp
          </label>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700" for="gender">Gender</label>
          <select
            id="gender"
            v-model="gender"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Not set</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700" for="referral-source">Referral source</label>
          <select
            id="referral-source"
            v-model="referralSource"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Not set</option>
            <option v-for="s in referralSources" :key="s.id" :value="s.name">{{ s.name }}</option>
          </select>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700" for="address">Address</label>
        <input
          id="address"
          v-model="address"
          type="text"
          placeholder="For invoices"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700" for="clinic">Clinic</label>
        <select
          id="clinic"
          v-model="clinicId"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">No primary clinic</option>
          <option v-for="clinic in store.clinics" :key="clinic.id" :value="clinic.id">
            {{ clinic.name }}
          </option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700" for="tags">Tags</label>
        <input
          id="tags"
          v-model="tagsInput"
          type="text"
          placeholder="comma, separated, tags"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <div class="flex gap-3">
        <button
          type="submit"
          :disabled="saving"
          class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ saving ? 'Saving…' : 'Add Patient' }}
        </button>
        <NuxtLink to="/patients" class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
