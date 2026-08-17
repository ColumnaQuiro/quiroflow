<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()

const firstName = ref('')
const lastName = ref('')
const dateOfBirth = ref('')
const email = ref('')
const phone = ref('')
const clinicId = ref(store.currentClinicId ?? '')
const tagsInput = ref('')
const error = ref('')
const saving = ref(false)

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
      phone: phone.value || null,
      tags,
    })
    .select('id')
    .single()

  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
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
        <div>
          <label class="block text-sm font-medium text-gray-700" for="phone">Phone</label>
          <input
            id="phone"
            v-model="phone"
            type="tel"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
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
