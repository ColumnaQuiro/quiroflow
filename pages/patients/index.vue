<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type Patient = Pick<
  Tables<'patients'>,
  'id' | 'first_name' | 'last_name' | 'date_of_birth' | 'balance_cents' | 'tags' | 'clinic_id' | 'email' | 'default_practitioner_id'
>

const supabase = useSupabaseClient()
const store = useAccountStore()

const PAGE_SIZE = 50

interface TeamMemberOption { id: string; full_name: string }
interface CarePlanInfo { name: string; totalVisits: number; completed: number }

const search = ref('')
const balanceFilter = ref<'any' | 'credit' | 'debit' | 'zero'>('any')
const missingEmail = ref(false)
const missingPhone = ref(false)
const practitionerFilter = ref('')
const allClinics = ref(false)
const patients = ref<Patient[]>([])
const nextAppointmentByPatient = ref<Record<string, string>>({})
const carePlanByPatient = ref<Record<string, CarePlanInfo>>({})
const teamMembers = ref<TeamMemberOption[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name').order('full_name')
  teamMembers.value = data ?? []
})
const page = ref(1)
const totalCount = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))

// Filter-syntax characters in PostgREST's .or() string -- strip them from
// search input rather than trying to escape them, so a stray "%" or ","
// can't wildcard-match or break the filter shape.
function sanitizeToken(s: string) {
  return s.replace(/[%_,()]/g, '')
}

async function loadPatients() {
  loading.value = true

  let query = supabase
    .from('patients')
    .select('id, first_name, last_name, date_of_birth, balance_cents, tags, clinic_id, email, default_practitioner_id', { count: 'exact' })

  if (!allClinics.value && store.currentClinicId) query = query.eq('clinic_id', store.currentClinicId)
  if (balanceFilter.value === 'credit') query = query.gt('balance_cents', 0)
  if (balanceFilter.value === 'debit') query = query.lt('balance_cents', 0)
  if (balanceFilter.value === 'zero') query = query.eq('balance_cents', 0)
  if (missingEmail.value) query = query.or('email.is.null,email.eq.')
  if (practitionerFilter.value) query = query.eq('default_practitioner_id', practitionerFilter.value)
  if (missingPhone.value) query = query.eq('has_phone', false)

  // Each word must match somewhere in first/last name -- chaining .or()
  // calls ANDs the groups together, so "john sm" matches "John Smith"
  // regardless of which word landed in which name field.
  const tokens = search.value.trim().split(/\s+/).map(sanitizeToken).filter(Boolean)
  for (const token of tokens) {
    query = query.or(`first_name.ilike.%${token}%,last_name.ilike.%${token}%`)
  }

  const from = (page.value - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const { data, count } = await query.order('first_name').range(from, to)

  patients.value = data ?? []
  totalCount.value = count ?? 0

  const ids = patients.value.map((p) => p.id)
  if (ids.length > 0) {
    const { data: upcoming } = await supabase
      .from('appointments')
      .select('patient_id, starts_at')
      .eq('status', 'booked')
      .gt('starts_at', new Date().toISOString())
      .in('patient_id', ids)
      .order('starts_at')
    const nextByPatient: Record<string, string> = {}
    for (const a of upcoming ?? []) {
      if (!nextByPatient[a.patient_id]) nextByPatient[a.patient_id] = a.starts_at
    }
    nextAppointmentByPatient.value = nextByPatient

    const [{ data: plans }, { data: completedAppts }] = await Promise.all([
      supabase
        .from('care_plans')
        .select('patient_id, name, total_visits, created_at')
        .in('patient_id', ids)
        .order('created_at', { ascending: false }),
      supabase.from('appointments').select('patient_id').eq('status', 'completed').in('patient_id', ids),
    ])
    const completedByPatient: Record<string, number> = {}
    for (const a of completedAppts ?? []) {
      completedByPatient[a.patient_id] = (completedByPatient[a.patient_id] ?? 0) + 1
    }
    const planByPatient: Record<string, CarePlanInfo> = {}
    for (const p of plans ?? []) {
      if (!planByPatient[p.patient_id]) {
        planByPatient[p.patient_id] = { name: p.name, totalVisits: p.total_visits, completed: completedByPatient[p.patient_id] ?? 0 }
      }
    }
    carePlanByPatient.value = planByPatient
  } else {
    nextAppointmentByPatient.value = {}
    carePlanByPatient.value = {}
  }

  loading.value = false
}
onMounted(loadPatients)

function goToPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  loadPatients()
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => goToPage(1), 300)
})
watch([balanceFilter, allClinics, missingEmail, missingPhone, practitionerFilter], () => goToPage(1))

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
        <p v-if="!loading" class="mt-1 text-sm text-gray-500">{{ totalCount }} patients</p>
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
      <select
        v-model="practitionerFilter"
        class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">Any practitioner</option>
        <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
      </select>
      <label class="flex items-center gap-1.5 text-sm text-gray-600">
        <input v-model="missingEmail" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        Missing email
      </label>
      <label class="flex items-center gap-1.5 text-sm text-gray-600">
        <input v-model="missingPhone" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        Missing phone
      </label>
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
            <th class="px-5 py-3">Care Plan</th>
            <th class="px-5 py-3">Tags</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="6" class="px-5 py-10 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="patients.length === 0">
            <td colspan="6" class="px-5 py-10 text-center text-gray-400">No patients found.</td>
          </tr>
          <tr
            v-for="patient in patients"
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
            <td class="px-5 py-3 text-gray-500">
              <span v-if="carePlanByPatient[patient.id]">{{ carePlanByPatient[patient.id].name }} ({{ carePlanByPatient[patient.id].completed }}/{{ carePlanByPatient[patient.id].totalVisits }})</span>
              <span v-else>—</span>
            </td>
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

      <div v-if="!loading && totalCount > 0" class="flex items-center justify-between border-t border-gray-200 px-5 py-3 text-sm text-gray-500">
        <span>Page {{ page }} of {{ totalPages }} &middot; {{ totalCount }} patients</span>
        <div class="flex gap-2">
          <button
            type="button"
            :disabled="page <= 1"
            class="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            @click="goToPage(page - 1)"
          >
            Previous
          </button>
          <button
            type="button"
            :disabled="page >= totalPages"
            class="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            @click="goToPage(page + 1)"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
