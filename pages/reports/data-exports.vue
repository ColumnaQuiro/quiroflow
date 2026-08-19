<script setup lang="ts">
import Papa from 'papaparse'

interface PatientRow {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  default_practitioner_id: string | null
}
interface TeamMemberRow { id: string; full_name: string }

const supabase = useSupabaseClient()

const loading = ref(true)
const patients = ref<PatientRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])
const patientIdsWithPhone = ref<Set<string>>(new Set())
const patientIdsWithDataProtection = ref<Set<string>>(new Set())
const patientIdsWithConsent = ref<Set<string>>(new Set())

async function fetchAllIds<T = { patient_id: string }>(table: string, select: string, filter?: (q: any) => any): Promise<T[]> {
  const PAGE_SIZE = 1000
  const rows: T[] = []
  for (let page = 0; ; page++) {
    let query = supabase.from(table).select(select).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (filter) query = filter(query)
    const { data } = await query
    rows.push(...((data as T[]) ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

async function load() {
  loading.value = true

  const [patientRows, memberRows, contactRows] = await Promise.all([
    fetchAllIds<PatientRow>('patients', 'id, first_name, last_name, email, default_practitioner_id'),
    supabase.from('team_members').select('id, full_name').then((r) => r.data ?? []),
    fetchAllIds<{ patient_id: string }>('patient_contact_numbers', 'patient_id'),
  ])
  patients.value = patientRows
  teamMembers.value = memberRows
  patientIdsWithPhone.value = new Set(contactRows.map((r) => r.patient_id))

  const { data: categoryTemplates } = await supabase.from('doc_templates').select('id, category').not('category', 'is', null)
  const dataProtectionTemplateIds = new Set((categoryTemplates ?? []).filter((t) => t.category === 'data_protection').map((t) => t.id))
  const consentTemplateIds = new Set((categoryTemplates ?? []).filter((t) => t.category === 'consent').map((t) => t.id))

  const completedDocs = await fetchAllIds<{ patient_id: string; template_id: string | null }>(
    'patient_docs',
    'patient_id, template_id',
    (q) => q.not('completed_at', 'is', null).not('template_id', 'is', null),
  )
  patientIdsWithDataProtection.value = new Set(completedDocs.filter((d) => d.template_id && dataProtectionTemplateIds.has(d.template_id)).map((d) => d.patient_id))
  patientIdsWithConsent.value = new Set(completedDocs.filter((d) => d.template_id && consentTemplateIds.has(d.template_id)).map((d) => d.patient_id))

  loading.value = false
}
onMounted(load)

function label(p: PatientRow) {
  return `${p.first_name} ${p.last_name ?? ''}`.trim()
}

const withoutEmail = computed(() => patients.value.filter((p) => !p.email))
const withoutPhone = computed(() => patients.value.filter((p) => !patientIdsWithPhone.value.has(p.id)))
const withoutDataProtection = computed(() => patients.value.filter((p) => !patientIdsWithDataProtection.value.has(p.id)))
const withoutConsent = computed(() => patients.value.filter((p) => !patientIdsWithConsent.value.has(p.id)))

const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))
const perPractitioner = computed(() => {
  const counts = new Map<string, number>()
  for (const p of patients.value) {
    const key = p.default_practitioner_id ?? '__none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: id === '__none' ? 'Unassigned' : (memberById.value.get(id) ?? 'Unknown'), count }))
    .sort((a, b) => b.count - a.count)
})

const expanded = ref<string | null>(null)
function toggle(key: string) {
  expanded.value = expanded.value === key ? null : key
}

function exportCsv(filename: string, rows: PatientRow[]) {
  const csv = Papa.unparse(rows.map((p) => ({ Name: label(p), Email: p.email ?? '', ID: p.id })))
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Data Exports</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Gaps in patient records worth chasing down, and patient load per practitioner.</p>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>

    <div v-else class="mt-6 space-y-4">
      <div class="rounded-lg border border-gray-200 bg-white">
        <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('email')">
          <span class="text-sm font-medium text-gray-900">Missing email</span>
          <span class="text-sm text-gray-500">{{ withoutEmail.length }} patients</span>
        </button>
        <div v-if="expanded === 'email'" class="border-t border-gray-100 p-4">
          <button type="button" class="mb-2 text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="exportCsv('missing-email.csv', withoutEmail)">Export CSV</button>
          <ul class="max-h-64 overflow-y-auto divide-y divide-gray-100 text-sm">
            <li v-for="p in withoutEmail" :key="p.id" class="py-1.5">
              <NuxtLink :to="`/patients/${p.id}`" class="text-gray-700 hover:text-indigo-600">{{ label(p) }}</NuxtLink>
            </li>
          </ul>
        </div>
      </div>

      <div class="rounded-lg border border-gray-200 bg-white">
        <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('phone')">
          <span class="text-sm font-medium text-gray-900">Missing phone number</span>
          <span class="text-sm text-gray-500">{{ withoutPhone.length }} patients</span>
        </button>
        <div v-if="expanded === 'phone'" class="border-t border-gray-100 p-4">
          <button type="button" class="mb-2 text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="exportCsv('missing-phone.csv', withoutPhone)">Export CSV</button>
          <ul class="max-h-64 overflow-y-auto divide-y divide-gray-100 text-sm">
            <li v-for="p in withoutPhone" :key="p.id" class="py-1.5">
              <NuxtLink :to="`/patients/${p.id}`" class="text-gray-700 hover:text-indigo-600">{{ label(p) }}</NuxtLink>
            </li>
          </ul>
        </div>
      </div>

      <div class="rounded-lg border border-gray-200 bg-white">
        <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('dp')">
          <span class="text-sm font-medium text-gray-900">Missing data protection form</span>
          <span class="text-sm text-gray-500">{{ withoutDataProtection.length }} patients</span>
        </button>
        <div v-if="expanded === 'dp'" class="border-t border-gray-100 p-4">
          <p class="mb-2 text-xs text-gray-400">
            Based on the template marked <strong>Data protection</strong> in
            <NuxtLink to="/settings/docs" class="text-indigo-600 hover:text-indigo-500">Settings &rarr; Docs</NuxtLink>.
          </p>
          <button type="button" class="mb-2 text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="exportCsv('missing-data-protection.csv', withoutDataProtection)">Export CSV</button>
          <ul class="max-h-64 overflow-y-auto divide-y divide-gray-100 text-sm">
            <li v-for="p in withoutDataProtection" :key="p.id" class="py-1.5">
              <NuxtLink :to="`/patients/${p.id}`" class="text-gray-700 hover:text-indigo-600">{{ label(p) }}</NuxtLink>
            </li>
          </ul>
        </div>
      </div>

      <div class="rounded-lg border border-gray-200 bg-white">
        <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('consent')">
          <span class="text-sm font-medium text-gray-900">Missing consent form</span>
          <span class="text-sm text-gray-500">{{ withoutConsent.length }} patients</span>
        </button>
        <div v-if="expanded === 'consent'" class="border-t border-gray-100 p-4">
          <p class="mb-2 text-xs text-gray-400">
            Based on the template marked <strong>Consent</strong> in
            <NuxtLink to="/settings/docs" class="text-indigo-600 hover:text-indigo-500">Settings &rarr; Docs</NuxtLink>.
          </p>
          <button type="button" class="mb-2 text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="exportCsv('missing-consent.csv', withoutConsent)">Export CSV</button>
          <ul class="max-h-64 overflow-y-auto divide-y divide-gray-100 text-sm">
            <li v-for="p in withoutConsent" :key="p.id" class="py-1.5">
              <NuxtLink :to="`/patients/${p.id}`" class="text-gray-700 hover:text-indigo-600">{{ label(p) }}</NuxtLink>
            </li>
          </ul>
        </div>
      </div>

      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <h3 class="text-sm font-semibold text-gray-900">Patients per practitioner</h3>
        <ul class="mt-2 space-y-1.5">
          <li v-for="row in perPractitioner" :key="row.id" class="flex items-center justify-between text-sm">
            <span class="text-gray-700">{{ row.label }}</span>
            <span class="font-medium text-gray-900">{{ row.count }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
