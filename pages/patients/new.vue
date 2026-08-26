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
const postalCode = ref('')
const city = ref('')
const country = ref('')
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
      postal_code: postalCode.value || null,
      city: city.value || null,
      country: country.value || null,
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
  <div class="flex h-full flex-col">
    <PageHeader title="Add Patient" />
    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div class="max-w-lg">
        <form class="space-y-4 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="onSubmit">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-ink-700" for="first-name">First name</label>
              <input
                id="first-name"
                v-model="firstName"
                type="text"
                required
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-700" for="last-name">Last name</label>
              <input
                id="last-name"
                v-model="lastName"
                type="text"
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-ink-700" for="dob">Date of birth</label>
            <input
              id="dob"
              v-model="dateOfBirth"
              type="date"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-ink-700" for="email">Email</label>
              <input
                id="email"
                v-model="email"
                type="email"
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div class="min-w-0">
              <label class="block text-sm font-medium text-ink-700">Phone</label>
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
                  class="min-w-0 flex-1 rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <label class="mt-1.5 flex items-center gap-1.5 text-sm text-ink-muted">
                <input v-model="phoneIsWhatsapp" type="checkbox" class="rounded border-line-control accent-brand focus:ring-brand" />
                This number has WhatsApp
              </label>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-ink-700" for="gender">Gender</label>
              <select
                id="gender"
                v-model="gender"
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-700" for="referral-source">Referral source</label>
              <select
                id="referral-source"
                v-model="referralSource"
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="">Not set</option>
                <option v-for="s in referralSources" :key="s.id" :value="s.name">{{ s.name }}</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-ink-700" for="address">Street address</label>
            <input
              id="address"
              v-model="address"
              type="text"
              placeholder="For invoices"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-sm font-medium text-ink-700" for="postal-code">Postal code</label>
              <input
                id="postal-code"
                v-model="postalCode"
                type="text"
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-700" for="city">City</label>
              <input
                id="city"
                v-model="city"
                type="text"
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-700" for="country">Country</label>
              <input
                id="country"
                v-model="country"
                type="text"
                class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-ink-700" for="clinic">Clinic</label>
            <select
              id="clinic"
              v-model="clinicId"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">No primary clinic</option>
              <option v-for="clinic in store.clinics" :key="clinic.id" :value="clinic.id">
                {{ clinic.name }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-ink-700" for="tags">Tags</label>
            <input
              id="tags"
              v-model="tagsInput"
              type="text"
              placeholder="comma, separated, tags"
              class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>

          <div class="flex gap-3">
            <UiBtn type="submit" variant="primary" :disabled="saving">
              {{ saving ? 'Saving…' : 'Add Patient' }}
            </UiBtn>
            <NuxtLink to="/patients" class="rounded-ctl px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-subtle">
              Cancel
            </NuxtLink>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
