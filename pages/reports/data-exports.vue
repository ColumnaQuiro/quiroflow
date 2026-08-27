<script setup lang="ts">
import Papa from 'papaparse'
import { computePresetRange, STANDARD_PRESETS, type DateRange } from '~/composables/useDateRangePresets'

interface PatientRow {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  default_practitioner_id: string | null
  date_of_birth: string | null
  created_at: string
  status: string
  tags: string[]
}
interface TeamMemberRow { id: string; full_name: string }
interface GeneratedExport {
  id: string
  dataTypeLabel: string
  filterSummary: string
  rowCount: number
  generatedAt: string
  blobUrl: string
  filename: string
}

// Only "Patients" actually generates anything today -- the other data types
// mirror PracticeHub's own dropdown (matching its layout, per the QA
// request) but aren't wired to real exports yet, so picking one just
// disables the button rather than pretending to support it.
const DATA_TYPES = [
  { value: 'patients', label: 'Patients' },
  { value: 'patient_logs', label: 'Patient Logs' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'care_plans', label: 'Care Plans' },
  { value: 'treatment_notes', label: 'Treatment Notes' },
  { value: 'custom_form_responses', label: 'Custom Form Responses' },
  { value: 'file_attachments', label: 'File Attachments - List' },
]

const supabase = useSupabaseClient()

const loading = ref(true)
const patients = ref<PatientRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])
const patientIdsWithPhone = ref<Set<string>>(new Set())
const phoneByPatient = ref<Map<string, string>>(new Map())
const patientIdsWithDataProtection = ref<Set<string>>(new Set())
const patientIdsWithConsent = ref<Set<string>>(new Set())
const patientIdsWithFutureAppointment = ref<Set<string>>(new Set())
const balanceByPatient = ref<Map<string, number>>(new Map())
// patient_live_balances computes 3 correlated subqueries per patient row --
// fine for one patient (usePatientFinancialSummary) but 15-20s+ for an
// account's full patient list, so it's loaded lazily (on first need) rather
// than blocking this page's initial load for a filter/column that may not
// even be used this visit.
const balancesLoading = ref(false)
const balancesLoaded = ref(false)

async function fetchAllRows<T>(table: string, select: string, filter?: (q: any) => any): Promise<T[]> {
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

  const [patientRows, memberRows, contactRows, futureAppts] = await Promise.all([
    fetchAllRows<PatientRow>('patients', 'id, first_name, last_name, email, default_practitioner_id, date_of_birth, created_at, status, tags'),
    supabase.from('team_members').select('id, full_name').then((r) => r.data ?? []),
    fetchAllRows<{ patient_id: string; number: string; country_code: string }>('patient_contact_numbers', 'patient_id, number, country_code'),
    fetchAllRows<{ patient_id: string }>('appointments', 'patient_id', (q) => q.neq('status', 'cancelled').gt('starts_at', new Date().toISOString())),
  ])
  patients.value = patientRows
  teamMembers.value = memberRows
  patientIdsWithPhone.value = new Set(contactRows.map((r) => r.patient_id))
  phoneByPatient.value = new Map(contactRows.map((r) => [r.patient_id, r.number]))
  patientIdsWithFutureAppointment.value = new Set(futureAppts.map((r) => r.patient_id))

  const { data: categoryTemplates } = await supabase.from('doc_templates').select('id, category').not('category', 'is', null)
  const dataProtectionTemplateIds = new Set((categoryTemplates ?? []).filter((t) => t.category === 'data_protection').map((t) => t.id))
  const consentTemplateIds = new Set((categoryTemplates ?? []).filter((t) => t.category === 'consent').map((t) => t.id))

  const completedDocs = await fetchAllRows<{ patient_id: string; template_id: string | null }>(
    'patient_docs',
    'patient_id, template_id',
    (q) => q.not('completed_at', 'is', null).not('template_id', 'is', null),
  )
  patientIdsWithDataProtection.value = new Set(completedDocs.filter((d) => d.template_id && dataProtectionTemplateIds.has(d.template_id)).map((d) => d.patient_id))
  patientIdsWithConsent.value = new Set(completedDocs.filter((d) => d.template_id && consentTemplateIds.has(d.template_id)).map((d) => d.patient_id))

  loading.value = false
}
onMounted(load)

async function ensureBalancesLoaded() {
  if (balancesLoaded.value || balancesLoading.value) return
  balancesLoading.value = true
  const rows = await fetchAllRows<{ patient_id: string; balance_cents: number }>('patient_live_balances', 'patient_id, balance_cents')
  balanceByPatient.value = new Map(rows.map((r) => [r.patient_id, r.balance_cents]))
  balancesLoaded.value = true
  balancesLoading.value = false
}

function label(p: PatientRow) {
  return `${p.first_name} ${p.last_name ?? ''}`.trim()
}
function ageOf(p: PatientRow): number | null {
  if (!p.date_of_birth) return null
  const dob = new Date(p.date_of_birth)
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const beforeBirthday = now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())
  if (beforeBirthday) age--
  return age
}
const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))

// -- Generate New Export -----------------------------------------------
const dataType = ref('patients')
const dateRange = ref<DateRange | null>(null)
const dateRangeOpen = ref(false)
const customFrom = ref('')
const customTo = ref('')

function selectPreset(preset: (typeof STANDARD_PRESETS)[number]) {
  dateRange.value = computePresetRange(preset)
  dateRangeOpen.value = false
}
function applyCustomRange() {
  if (!customFrom.value || !customTo.value || customFrom.value > customTo.value) return
  dateRange.value = { from: customFrom.value, to: customTo.value }
  dateRangeOpen.value = false
}
function clearDateRange() {
  dateRange.value = null
  customFrom.value = ''
  customTo.value = ''
  dateRangeOpen.value = false
}
function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const dateRangeLabel = computed(() =>
  dateRange.value ? `${formatDate(dateRange.value.from)} – ${formatDate(dateRange.value.to)}` : 'Select date range…',
)

const filterMissingEmail = ref(false)
const filterMissingPhone = ref(false)
const filterMissingDataProtection = ref(false)
const filterMissingConsent = ref(false)
const filterMissingNextAppointment = ref(false)
const filterNeedsToPay = ref(false)
const filterAgeMin = ref('')
const filterAgeMax = ref('')

watch(filterNeedsToPay, (on) => {
  if (on) ensureBalancesLoaded()
})

const matchingPatients = computed(() => {
  let rows = patients.value
  if (dateRange.value) {
    const from = `${dateRange.value.from}T00:00:00`
    const to = `${dateRange.value.to}T23:59:59.999`
    rows = rows.filter((p) => p.created_at >= from && p.created_at <= to)
  }
  if (filterMissingEmail.value) rows = rows.filter((p) => !p.email)
  if (filterMissingPhone.value) rows = rows.filter((p) => !patientIdsWithPhone.value.has(p.id))
  if (filterMissingDataProtection.value) rows = rows.filter((p) => !patientIdsWithDataProtection.value.has(p.id))
  if (filterMissingConsent.value) rows = rows.filter((p) => !patientIdsWithConsent.value.has(p.id))
  if (filterMissingNextAppointment.value) rows = rows.filter((p) => !patientIdsWithFutureAppointment.value.has(p.id))
  if (filterNeedsToPay.value) rows = rows.filter((p) => (balanceByPatient.value.get(p.id) ?? 0) < 0)
  const min = filterAgeMin.value ? parseInt(filterAgeMin.value, 10) : null
  const max = filterAgeMax.value ? parseInt(filterAgeMax.value, 10) : null
  if (min != null || max != null) {
    rows = rows.filter((p) => {
      const age = ageOf(p)
      if (age == null) return false
      if (min != null && age < min) return false
      if (max != null && age > max) return false
      return true
    })
  }
  return rows
})

const activeFilterLabels = computed(() => {
  const labels: string[] = []
  if (filterMissingEmail.value) labels.push('Missing email')
  if (filterMissingPhone.value) labels.push('Missing phone')
  if (filterMissingDataProtection.value) labels.push('Missing data protection form')
  if (filterMissingConsent.value) labels.push('Missing consent form')
  if (filterMissingNextAppointment.value) labels.push('Missing next appointment')
  if (filterNeedsToPay.value) labels.push('Needs to pay')
  if (filterAgeMin.value || filterAgeMax.value) labels.push(`Age ${filterAgeMin.value || '0'}–${filterAgeMax.value || '∞'}`)
  return labels
})

const generatedExports = ref<GeneratedExport[]>([])
onUnmounted(() => {
  for (const e of generatedExports.value) URL.revokeObjectURL(e.blobUrl)
})

const generating = ref(false)
async function generateExport() {
  generating.value = true
  await ensureBalancesLoaded()
  const rows = matchingPatients.value
  const csv = Papa.unparse(
    rows.map((p) => ({
      'First name': p.first_name,
      'Last name': p.last_name ?? '',
      Email: p.email ?? '',
      Phone: phoneByPatient.value.get(p.id) ?? '',
      'Date of birth': p.date_of_birth ?? '',
      Age: ageOf(p) ?? '',
      Practitioner: p.default_practitioner_id ? (memberById.value.get(p.default_practitioner_id) ?? '') : 'Unassigned',
      'Balance (€)': ((balanceByPatient.value.get(p.id) ?? 0) / 100).toFixed(2),
      'Has next appointment': patientIdsWithFutureAppointment.value.has(p.id) ? 'Yes' : 'No',
      'Data protection form signed': patientIdsWithDataProtection.value.has(p.id) ? 'Yes' : 'No',
      'Consent form signed': patientIdsWithConsent.value.has(p.id) ? 'Yes' : 'No',
      Status: p.status,
      Tags: p.tags.join('; '),
      ID: p.id,
    })),
  )
  const blob = new Blob([csv], { type: 'text/csv' })
  const blobUrl = URL.createObjectURL(blob)
  const filename = `patients-export-${new Date().toISOString().slice(0, 10)}-${generatedExports.value.length + 1}.csv`

  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  a.click()

  generatedExports.value.unshift({
    id: crypto.randomUUID(),
    dataTypeLabel: DATA_TYPES.find((t) => t.value === dataType.value)?.label ?? 'Patients',
    filterSummary: [dateRange.value ? dateRangeLabel.value : null, ...activeFilterLabels.value].filter(Boolean).join(' · ') || 'All patients',
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
    blobUrl,
    filename,
  })
  generating.value = false
}

function redownload(exp: GeneratedExport) {
  const a = document.createElement('a')
  a.href = exp.blobUrl
  a.download = exp.filename
  a.click()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Data Exports" meta="Export patient data, or find gaps in patient records worth chasing down">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; Reports</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div v-if="loading" class="text-[13px] text-ink-faint2">Loading…</div>

      <div v-else class="mx-auto max-w-3xl space-y-6">
        <div class="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 class="text-[15px] font-semibold text-ink-900">Generate New Export</h3>
          <p class="mt-0.5 text-[12.5px] text-ink-muted2">Select the data type, date range, and any filters for your export.</p>

          <div class="mt-4">
            <label class="block text-[12.5px] font-medium text-ink-600">Data Type</label>
            <select v-model="dataType" class="mt-1 h-9 w-full max-w-xs rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none">
              <option v-for="t in DATA_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
            <p v-if="dataType !== 'patients'" class="mt-1 text-[12px] text-warning-text">This data type isn't available to export yet.</p>
          </div>

          <div class="relative mt-4 max-w-xs">
            <label class="block text-[12.5px] font-medium text-ink-600">Created Date Range</label>
            <p class="mt-0.5 text-[11.5px] text-ink-faint2">Filters by the created date of each patient</p>
            <button
              type="button"
              class="mt-1 flex h-9 w-full items-center justify-between rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 hover:border-line-controlHover"
              @click="dateRangeOpen = !dateRangeOpen"
            >
              <span class="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" class="shrink-0 text-ink-faint">
                  <rect x="2" y="3" width="12" height="11" rx="1.3" />
                  <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke-linecap="round" />
                </svg>
                {{ dateRangeLabel }}
              </span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" class="shrink-0 text-ink-faint"><path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>

            <div v-if="dateRangeOpen" class="absolute left-0 z-30 mt-1 w-72 rounded-ctl border border-line bg-surface p-2 shadow-popover">
              <button
                v-for="p in STANDARD_PRESETS"
                :key="p.label"
                type="button"
                class="block w-full rounded-ctlSm px-2 py-1.5 text-left text-[13px] text-ink-600 hover:bg-surface-subtle"
                @click="selectPreset(p)"
              >
                {{ p.label }}
              </button>
              <div class="mt-1 border-t border-line-divider pt-2">
                <p class="px-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint2">Custom range</p>
                <div class="mt-1 flex items-center gap-1.5 px-2">
                  <input v-model="customFrom" type="date" :max="customTo || undefined" class="min-w-0 flex-1 rounded-ctlSm border border-line-control px-1.5 py-1 text-xs text-ink-600" />
                  <span class="shrink-0 text-ink-faint2">–</span>
                  <input v-model="customTo" type="date" :min="customFrom || undefined" class="min-w-0 flex-1 rounded-ctlSm border border-line-control px-1.5 py-1 text-xs text-ink-600" />
                </div>
                <button
                  type="button"
                  :disabled="!customFrom || !customTo"
                  class="mt-2 w-full rounded-ctl border border-brand bg-brand px-2 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                  @click="applyCustomRange"
                >
                  Apply
                </button>
                <button type="button" class="mt-1 w-full rounded-ctl px-2 py-1.5 text-xs font-medium text-ink-muted2 hover:bg-surface-subtle" @click="clearDateRange">
                  Clear (all time)
                </button>
              </div>
            </div>
          </div>

          <div class="mt-5 border-t border-line-divider pt-4">
            <p class="text-[12.5px] font-medium text-ink-600">Filters</p>
            <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              <label class="flex items-center gap-2 text-[13px] text-ink-700">
                <input v-model="filterMissingEmail" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
                Missing email
              </label>
              <label class="flex items-center gap-2 text-[13px] text-ink-700">
                <input v-model="filterMissingPhone" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
                Missing phone number
              </label>
              <label class="flex items-center gap-2 text-[13px] text-ink-700">
                <input v-model="filterMissingDataProtection" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
                Missing data protection form
              </label>
              <label class="flex items-center gap-2 text-[13px] text-ink-700">
                <input v-model="filterMissingConsent" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
                Missing consent form
              </label>
              <label class="flex items-center gap-2 text-[13px] text-ink-700">
                <input v-model="filterMissingNextAppointment" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
                Missing next appointment
              </label>
              <label class="flex items-center gap-2 text-[13px] text-ink-700">
                <input v-model="filterNeedsToPay" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
                Patient needs to pay
                <span v-if="filterNeedsToPay && balancesLoading" class="text-[11.5px] text-ink-faint2">(loading balances…)</span>
              </label>
            </div>
            <div class="mt-3 flex items-center gap-2">
              <label class="text-[13px] text-ink-700">Age</label>
              <input v-model="filterAgeMin" type="number" min="0" placeholder="Min" class="h-8 w-20 rounded-ctlSm border border-line-control px-2 text-[13px] text-ink-700" />
              <span class="text-ink-faint2">–</span>
              <input v-model="filterAgeMax" type="number" min="0" placeholder="Max" class="h-8 w-20 rounded-ctlSm border border-line-control px-2 text-[13px] text-ink-700" />
            </div>
          </div>

          <div class="mt-5 flex items-center justify-between border-t border-line-divider pt-4">
            <p class="text-[12.5px] text-ink-muted2">{{ matchingPatients.length }} patient{{ matchingPatients.length === 1 ? '' : 's' }} match{{ matchingPatients.length === 1 ? 'es' : '' }} right now</p>
            <UiBtn variant="primary" :disabled="dataType !== 'patients' || generating" @click="generateExport">{{ generating ? 'Generating…' : 'Generate Export' }}</UiBtn>
          </div>
        </div>

        <div v-if="generatedExports.length === 0" class="flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-10 text-center shadow-card">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" class="text-ink-faint2">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
            <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
          </svg>
          <p class="text-[13.5px] font-semibold text-ink-800">No exports generated</p>
          <p class="text-[12.5px] text-ink-muted2">To generate a data export, choose from the options above.</p>
        </div>

        <div v-else class="rounded-card border border-line bg-surface shadow-card">
          <p class="border-b border-line-divider px-4 py-2.5 text-[12.5px] font-medium text-ink-600">Generated this session</p>
          <ul class="divide-y divide-line-row">
            <li v-for="exp in generatedExports" :key="exp.id" class="flex items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="truncate text-[13px] font-medium text-ink-900">{{ exp.dataTypeLabel }} — {{ exp.rowCount }} row{{ exp.rowCount === 1 ? '' : 's' }}</p>
                <p class="truncate text-[12px] text-ink-muted2">{{ exp.filterSummary }} · {{ new Date(exp.generatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}</p>
              </div>
              <UiBtn variant="ghost" size="sm" class="shrink-0" @click="redownload(exp)">Download CSV</UiBtn>
            </li>
          </ul>
        </div>

        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">Patients per practitioner</h3>
          <ul class="mt-2 space-y-1.5">
            <li
              v-for="row in [...teamMembers.map((m) => ({ id: m.id, label: m.full_name })), { id: '__none', label: 'Unassigned' }]
                .map((m) => ({ ...m, count: patients.filter((p) => (p.default_practitioner_id ?? '__none') === m.id).length }))
                .filter((r) => r.count > 0)
                .sort((a, b) => b.count - a.count)"
              :key="row.id"
              class="flex items-center justify-between text-[13px]"
            >
              <span class="text-ink-600">{{ row.label }}</span>
              <span class="font-mono font-medium text-ink-900">{{ row.count }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
