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
  <div class="flex h-full flex-col">
    <PageHeader title="Data Exports" meta="Gaps in patient records worth chasing down">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; Reports</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div v-if="loading" class="text-[13px] text-ink-faint2">Loading…</div>

      <div v-else class="space-y-4">
        <div class="rounded-card border border-line bg-surface shadow-card">
          <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('email')">
            <span class="text-[13px] font-medium text-ink-900">Missing email</span>
            <span class="font-mono text-[13px] text-ink-muted2">{{ withoutEmail.length }} patients</span>
          </button>
          <div v-if="expanded === 'email'" class="border-t border-line-divider p-4">
            <UiBtn variant="ghost" size="sm" class="mb-2" @click="exportCsv('missing-email.csv', withoutEmail)">Export CSV</UiBtn>
            <ul class="max-h-64 overflow-y-auto divide-y divide-line-row text-[13px]">
              <li v-for="p in withoutEmail" :key="p.id" class="py-1.5">
                <NuxtLink :to="`/patients/${p.id}`" class="text-ink-600 hover:text-brand-text">{{ label(p) }}</NuxtLink>
              </li>
            </ul>
          </div>
        </div>

        <div class="rounded-card border border-line bg-surface shadow-card">
          <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('phone')">
            <span class="text-[13px] font-medium text-ink-900">Missing phone number</span>
            <span class="font-mono text-[13px] text-ink-muted2">{{ withoutPhone.length }} patients</span>
          </button>
          <div v-if="expanded === 'phone'" class="border-t border-line-divider p-4">
            <UiBtn variant="ghost" size="sm" class="mb-2" @click="exportCsv('missing-phone.csv', withoutPhone)">Export CSV</UiBtn>
            <ul class="max-h-64 overflow-y-auto divide-y divide-line-row text-[13px]">
              <li v-for="p in withoutPhone" :key="p.id" class="py-1.5">
                <NuxtLink :to="`/patients/${p.id}`" class="text-ink-600 hover:text-brand-text">{{ label(p) }}</NuxtLink>
              </li>
            </ul>
          </div>
        </div>

        <div class="rounded-card border border-line bg-surface shadow-card">
          <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('dp')">
            <span class="text-[13px] font-medium text-ink-900">Missing data protection form</span>
            <span class="font-mono text-[13px] text-ink-muted2">{{ withoutDataProtection.length }} patients</span>
          </button>
          <div v-if="expanded === 'dp'" class="border-t border-line-divider p-4">
            <p class="mb-2 text-[12px] text-ink-faint2">
              Based on the template marked <strong>Data protection</strong> in
              <NuxtLink to="/settings/docs" class="text-brand-text hover:text-brand-hover">Settings &rarr; Docs</NuxtLink>.
            </p>
            <UiBtn variant="ghost" size="sm" class="mb-2" @click="exportCsv('missing-data-protection.csv', withoutDataProtection)">Export CSV</UiBtn>
            <ul class="max-h-64 overflow-y-auto divide-y divide-line-row text-[13px]">
              <li v-for="p in withoutDataProtection" :key="p.id" class="py-1.5">
                <NuxtLink :to="`/patients/${p.id}`" class="text-ink-600 hover:text-brand-text">{{ label(p) }}</NuxtLink>
              </li>
            </ul>
          </div>
        </div>

        <div class="rounded-card border border-line bg-surface shadow-card">
          <button type="button" class="flex w-full items-center justify-between p-4 text-left" @click="toggle('consent')">
            <span class="text-[13px] font-medium text-ink-900">Missing consent form</span>
            <span class="font-mono text-[13px] text-ink-muted2">{{ withoutConsent.length }} patients</span>
          </button>
          <div v-if="expanded === 'consent'" class="border-t border-line-divider p-4">
            <p class="mb-2 text-[12px] text-ink-faint2">
              Based on the template marked <strong>Consent</strong> in
              <NuxtLink to="/settings/docs" class="text-brand-text hover:text-brand-hover">Settings &rarr; Docs</NuxtLink>.
            </p>
            <UiBtn variant="ghost" size="sm" class="mb-2" @click="exportCsv('missing-consent.csv', withoutConsent)">Export CSV</UiBtn>
            <ul class="max-h-64 overflow-y-auto divide-y divide-line-row text-[13px]">
              <li v-for="p in withoutConsent" :key="p.id" class="py-1.5">
                <NuxtLink :to="`/patients/${p.id}`" class="text-ink-600 hover:text-brand-text">{{ label(p) }}</NuxtLink>
              </li>
            </ul>
          </div>
        </div>

        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">Patients per practitioner</h3>
          <ul class="mt-2 space-y-1.5">
            <li v-for="row in perPractitioner" :key="row.id" class="flex items-center justify-between text-[13px]">
              <span class="text-ink-600">{{ row.label }}</span>
              <span class="font-mono font-medium text-ink-900">{{ row.count }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
