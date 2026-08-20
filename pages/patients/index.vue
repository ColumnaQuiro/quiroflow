<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type Patient = Pick<
  Tables<'patients'>,
  'id' | 'first_name' | 'last_name' | 'date_of_birth' | 'balance_cents' | 'tags' | 'clinic_id'
>

const supabase = useSupabaseClient()
const store = useAccountStore()

const search = ref('')
const balanceFilter = ref<'any' | 'credit' | 'debit' | 'zero'>('any')
const allClinics = ref(false)
const patients = ref<Patient[]>([])
const loading = ref(true)

async function loadPatients() {
  loading.value = true
  const { data } = await supabase
    .from('patients')
    .select('id, first_name, last_name, date_of_birth, balance_cents, tags, clinic_id')
    .order('first_name')
  patients.value = data ?? []
  loading.value = false
}
onMounted(loadPatients)

const filtered = computed(() => {
  return patients.value.filter((p) => {
    if (!allClinics.value && store.currentClinicId && p.clinic_id !== store.currentClinicId) return false
    if (search.value) {
      const name = `${p.first_name} ${p.last_name ?? ''}`.toLowerCase()
      if (!name.includes(search.value.toLowerCase())) return false
    }
    if (balanceFilter.value === 'credit' && p.balance_cents <= 0) return false
    if (balanceFilter.value === 'debit' && p.balance_cents >= 0) return false
    if (balanceFilter.value === 'zero' && p.balance_cents !== 0) return false
    return true
  })
})

function formatBalance(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  if (cents > 0) return { text: `€${amount} CR`, class: 'text-green-600' }
  if (cents < 0) return { text: `€${amount} DR`, class: 'text-red-600' }
  return { text: '€0.00', class: 'text-gray-500' }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Patients</h1>
      <NuxtLink
        to="/patients/new"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        + Add Patient
      </NuxtLink>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <input
        v-model="search"
        type="search"
        placeholder="Search by name"
        class="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <select
        v-model="balanceFilter"
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="any">Any balance</option>
        <option value="credit">In credit</option>
        <option value="debit">In debt</option>
        <option value="zero">Zero balance</option>
      </select>
      <label v-if="store.currentClinicId" class="flex items-center gap-1.5 text-sm text-gray-600">
        <input v-model="allClinics" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        Show all clinics
      </label>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Patient Name</th>
            <th class="px-4 py-2">Balance</th>
            <th class="px-4 py-2">Date of Birth</th>
            <th class="px-4 py-2">Tags</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="4" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="filtered.length === 0">
            <td colspan="4" class="px-4 py-6 text-center text-gray-400">No patients found.</td>
          </tr>
          <tr
            v-for="patient in filtered"
            :key="patient.id"
            class="cursor-pointer hover:bg-gray-50"
            @click="navigateTo(`/patients/${patient.id}`)"
          >
            <td class="px-4 py-2.5 font-medium text-gray-900">
              {{ patient.first_name }} {{ patient.last_name }}
            </td>
            <td class="px-4 py-2.5" :class="formatBalance(patient.balance_cents).class">
              {{ formatBalance(patient.balance_cents).text }}
            </td>
            <td class="px-4 py-2.5 text-gray-500">{{ patient.date_of_birth ?? 'N/A' }}</td>
            <td class="px-4 py-2.5">
              <span
                v-for="tag in patient.tags"
                :key="tag"
                class="mr-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
              >
                {{ tag }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
