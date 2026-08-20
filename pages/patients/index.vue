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
const nextAppointmentByPatient = ref<Record<string, string>>({})
const loading = ref(true)

async function loadPatients() {
  loading.value = true
  // fetchAllRows -- a plain .select() silently caps at 1000 rows, and this
  // account has 1509 patients, so the un-paged version was quietly hiding
  // roughly a third of them.
  const [rows, upcoming] = await Promise.all([
    fetchAllRows<Patient>((from, to) =>
      supabase.from('patients').select('id, first_name, last_name, date_of_birth, balance_cents, tags, clinic_id').order('first_name').range(from, to),
    ),
    fetchAllRows<{ patient_id: string; starts_at: string }>((from, to) =>
      supabase
        .from('appointments')
        .select('patient_id, starts_at')
        .eq('status', 'booked')
        .gt('starts_at', new Date().toISOString())
        .order('starts_at')
        .range(from, to),
    ),
  ])
  patients.value = rows
  const nextByPatient: Record<string, string> = {}
  for (const a of upcoming) {
    if (!nextByPatient[a.patient_id]) nextByPatient[a.patient_id] = a.starts_at
  }
  nextAppointmentByPatient.value = nextByPatient
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

function initials(p: Patient) {
  const a = p.first_name?.[0] ?? ''
  const b = p.last_name?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}

function formatBalance(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  if (cents > 0) return { text: `€${amount} CR`, class: 'bg-green-50 text-green-700' }
  if (cents < 0) return { text: `€${amount} DR`, class: 'bg-red-50 text-red-700' }
  return { text: '€0.00', class: 'bg-gray-100 text-gray-500' }
}

function formatNextAppointment(patientId: string) {
  const iso = nextAppointmentByPatient.value[patientId]
  if (!iso) return null
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">Patients</h1>
        <p v-if="!loading" class="mt-1 text-sm text-gray-500">{{ filtered.length }} of {{ patients.length }} patients</p>
      </div>
      <NuxtLink
        to="/patients/new"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
      >
        + Add Patient
      </NuxtLink>
    </div>

    <div class="mt-6 flex flex-wrap items-center gap-3">
      <div class="relative">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="search"
          type="search"
          placeholder="Search by name"
          class="w-72 rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <select
        v-model="balanceFilter"
        class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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

    <div class="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
            <th class="px-5 py-3">Patient</th>
            <th class="px-5 py-3">Balance</th>
            <th class="px-5 py-3">Date of Birth</th>
            <th class="px-5 py-3">Next Appointment</th>
            <th class="px-5 py-3">Tags</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="5" class="px-5 py-10 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="filtered.length === 0">
            <td colspan="5" class="px-5 py-10 text-center text-gray-400">No patients found.</td>
          </tr>
          <tr
            v-for="patient in filtered"
            :key="patient.id"
            class="cursor-pointer hover:bg-gray-50"
            @click="navigateTo(`/patients/${patient.id}`)"
          >
            <td class="px-5 py-3">
              <div class="flex items-center gap-3">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
                  {{ initials(patient) }}
                </span>
                <span class="font-medium text-gray-900">{{ patient.first_name }} {{ patient.last_name }}</span>
              </div>
            </td>
            <td class="px-5 py-3">
              <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium" :class="formatBalance(patient.balance_cents).class">
                {{ formatBalance(patient.balance_cents).text }}
              </span>
            </td>
            <td class="px-5 py-3 text-gray-500">{{ patient.date_of_birth ?? '—' }}</td>
            <td class="px-5 py-3 text-gray-500">{{ formatNextAppointment(patient.id) ?? '—' }}</td>
            <td class="px-5 py-3">
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
