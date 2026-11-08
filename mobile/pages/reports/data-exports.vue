<script setup lang="ts">
// Exportaciones de datos, on the phone: the web's pages/reports/data-exports.vue
// -- the patients missing an email, a phone, a signed data-protection or
// consent form, a next appointment, or owing money, by created date and age,
// counted and exported as the same CSV (same columns, same filters, same
// lazily loaded balances). Reshaped for a phone: the created-date range is a
// chip ("All time" until one is picked), the filters are a list of switches
// with the age range under them, and the CSV goes to the share sheet
// (utils/shareReportFile.ts) instead of a browser download, which the app's
// WebView does not do. Left out: the "Data Type" dropdown, whose other six
// entries mirror PracticeHub's and export nothing on the web either (only
// Patients is wired), and the PDF of the page (no report PDF on the app yet).
// Unlike the web, a failed read shows an error and Retry rather than counting
// what did load: a missing contact-numbers page would otherwise make everyone
// "missing a phone".
import { patientAge } from '../../../utils/patientAge'
import { computePresetRange, STANDARD_PRESETS, type DateRange } from '../../../composables/useDateRangePresets'
import type { Database } from '../../../types/database.types'
import { reportCsv, shareReportFile, shareReportMessage } from '~/utils/shareReportFile'

definePageMeta({ layout: 'practitioner' })

type TableOrView = keyof Database['public']['Tables'] | keyof Database['public']['Views']

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
  blob: Blob
  filename: string
}

const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context } = useReportAccess()

const loading = ref(true)
const failed = ref(false)
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
const balancesFailed = ref(false)

// The web's paging helper, throwing on a refused page instead of stopping
// there (see the header).
async function fetchAllRows<T>(table: TableOrView, select: string, filter?: (q: any) => any): Promise<T[]> {
  const PAGE_SIZE = 1000
  const rows: T[] = []
  for (let page = 0; ; page++) {
    // Supabase's .from() overloads split cleanly into "tables" and "views"
    // -- a variable that can be either can't satisfy either overload as a
    // whole, so this one spot casts through `any`; the generic <T> above is
    // what keeps each call site's result shape honest.
    let query = supabase.from(table as any).select(select).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (filter) query = filter(query)
    const { data, error } = await query
    if (error) throw error
    rows.push(...((data as T[]) ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

async function load() {
  loading.value = true
  failed.value = false
  try {
    const [patientRows, memberRows, contactRows, futureAppts] = await Promise.all([
      fetchAllRows<PatientRow>('patients', 'id, first_name, last_name, email, default_practitioner_id, date_of_birth, created_at, status, tags'),
      supabase.from('team_members').select('id, full_name').then((r) => {
        if (r.error) throw r.error
        return r.data ?? []
      }),
      fetchAllRows<{ patient_id: string; number: string; country_code: string }>('patient_contact_numbers', 'patient_id, number, country_code'),
      fetchAllRows<{ patient_id: string }>('appointments', 'patient_id', (q) => q.neq('status', 'cancelled').gt('starts_at', new Date().toISOString())),
    ])

    const { data: categoryTemplates, error: templatesError } = await supabase.from('doc_templates').select('id, category').not('category', 'is', null)
    if (templatesError) throw templatesError
    const dataProtectionTemplateIds = new Set((categoryTemplates ?? []).filter((d) => d.category === 'data_protection').map((d) => d.id))
    const consentTemplateIds = new Set((categoryTemplates ?? []).filter((d) => d.category === 'consent').map((d) => d.id))

    const completedDocs = await fetchAllRows<{ patient_id: string; template_id: string | null }>(
      'patient_docs',
      'patient_id, template_id',
      (q) => q.not('completed_at', 'is', null).not('template_id', 'is', null),
    )

    patients.value = patientRows
    teamMembers.value = memberRows
    patientIdsWithPhone.value = new Set(contactRows.map((r) => r.patient_id))
    phoneByPatient.value = new Map(contactRows.map((r) => [r.patient_id, r.number]))
    patientIdsWithFutureAppointment.value = new Set(futureAppts.map((r) => r.patient_id))
    patientIdsWithDataProtection.value = new Set(completedDocs.filter((d) => d.template_id && dataProtectionTemplateIds.has(d.template_id)).map((d) => d.patient_id))
    patientIdsWithConsent.value = new Set(completedDocs.filter((d) => d.template_id && consentTemplateIds.has(d.template_id)).map((d) => d.patient_id))
  } catch {
    failed.value = true
  }
  loading.value = false
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "no gaps anywhere".
watch(() => !!context.value && canOpen('/reports/data-exports'), (ok) => { if (ok) load() }, { immediate: true })

async function ensureBalancesLoaded() {
  if (balancesLoaded.value || balancesLoading.value) return
  balancesLoading.value = true
  balancesFailed.value = false
  try {
    const rows = await fetchAllRows<{ patient_id: string; balance_cents: number }>('patient_live_balances', 'patient_id, balance_cents')
    balanceByPatient.value = new Map(rows.map((r) => [r.patient_id, r.balance_cents]))
    balancesLoaded.value = true
  } catch {
    balancesFailed.value = true
  }
  balancesLoading.value = false
}

const ageOf = (p: PatientRow) => patientAge(p.date_of_birth)
const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))

// -- Created date range: none means all time ---------------------------
const dateRange = ref<DateRange | null>(null)
const rangeModel = computed<DateRange>({
  get: () => dateRange.value ?? computePresetRange(STANDARD_PRESETS[0]!),
  set: (r) => { dateRange.value = r },
})
function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'short', day: 'numeric', year: 'numeric' })
}
const dateRangeLabel = computed(() => (dateRange.value ? `${formatDate(dateRange.value.from)} – ${formatDate(dateRange.value.to)}` : t('All time', 'Todo el tiempo')))

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

const FILTERS = computed(() => [
  { key: 'email', model: filterMissingEmail, label: t('Missing email', 'Sin correo') },
  { key: 'phone', model: filterMissingPhone, label: t('Missing phone number', 'Sin número de teléfono') },
  { key: 'data-protection', model: filterMissingDataProtection, label: t('Missing data protection form', 'Sin formulario de protección de datos') },
  { key: 'consent', model: filterMissingConsent, label: t('Missing consent form', 'Sin formulario de consentimiento') },
  { key: 'next-appointment', model: filterMissingNextAppointment, label: t('Missing next appointment', 'Sin próxima cita') },
  { key: 'needs-to-pay', model: filterNeedsToPay, label: t('Patient needs to pay', 'El paciente tiene un pago pendiente') },
])

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
  if (filterMissingEmail.value) labels.push(t('Missing email', 'Sin correo'))
  if (filterMissingPhone.value) labels.push(t('Missing phone', 'Sin teléfono'))
  if (filterMissingDataProtection.value) labels.push(t('Missing data protection form', 'Sin formulario de protección de datos'))
  if (filterMissingConsent.value) labels.push(t('Missing consent form', 'Sin formulario de consentimiento'))
  if (filterMissingNextAppointment.value) labels.push(t('Missing next appointment', 'Sin próxima cita'))
  if (filterNeedsToPay.value) labels.push(t('Needs to pay', 'Pendiente de pago'))
  if (filterAgeMin.value || filterAgeMax.value) labels.push(t(`Age ${filterAgeMin.value || '0'}–${filterAgeMax.value || '∞'}`, `Edad ${filterAgeMin.value || '0'}–${filterAgeMax.value || '∞'}`))
  return labels
})

// The access log the web writes through useAccessLog (store-based, not here),
// written the way the app's patient record does it. Fire-and-forget.
function logExport(detail: Record<string, string | number>) {
  const accountId = context.value?.accountId
  if (!accountId) return
  supabase.rpc('log_patient_access', { p_account_id: accountId, p_kind: 'export', p_patient_id: undefined, p_detail: detail }).then(({ error }) => {
    if (error) console.warn('[access-log]', 'export', error.message)
  })
}

// A file waiting for a fresh tap. Only the app's web build gets here (see
// shareReportFile: the browser's sheet opens only within the tap that asked
// for it, and loading the balances outlives it); in the app it opens straight
// away.
const shareNote = ref<string | null>(null)
const pendingShare = ref<{ blob: Blob; filename: string; onOk?: () => void } | null>(null)
async function deliver(blob: Blob, filename: string, onOk?: () => void) {
  const result = await shareReportFile(blob, filename, 'text/csv')
  shareNote.value = shareReportMessage(result, t)
  pendingShare.value = result.status === 'needs-tap' ? { blob, filename, onOk } : null
  if (result.ok) onOk?.()
}
function sharePending() {
  const p = pendingShare.value
  if (p) deliver(p.blob, p.filename, p.onOk)
}

const generatedExports = ref<GeneratedExport[]>([])
const generating = ref(false)
async function generateExport() {
  generating.value = true
  shareNote.value = null
  pendingShare.value = null
  await ensureBalancesLoaded()
  // The Balance column and "needs to pay" read the balances: an export
  // without them would say everyone owes 0,00.
  if (!balancesLoaded.value) {
    shareNote.value = t("Couldn't load the balances, so the export was not made.", 'No se han podido cargar los saldos, así que no se ha generado la exportación.')
    generating.value = false
    return
  }
  const rows = matchingPatients.value
  const csv = reportCsv(
    rows.map((p) => ({
      [t('First name', 'Nombre')]: p.first_name,
      [t('Last name', 'Apellidos')]: p.last_name ?? '',
      [t('Email', 'Correo electrónico')]: p.email ?? '',
      [t('Phone', 'Teléfono')]: phoneByPatient.value.get(p.id) ?? '',
      [t('Date of birth', 'Fecha de nacimiento')]: p.date_of_birth ?? '',
      [t('Age', 'Edad')]: ageOf(p) ?? '',
      [t('Practitioner', 'Profesional')]: p.default_practitioner_id ? (memberById.value.get(p.default_practitioner_id) ?? '') : t('Unassigned', 'Sin asignar'),
      [t('Balance (€)', 'Saldo (€)')]: ((balanceByPatient.value.get(p.id) ?? 0) / 100).toFixed(2),
      [t('Has next appointment', 'Tiene próxima cita')]: patientIdsWithFutureAppointment.value.has(p.id) ? t('Yes', 'Sí') : t('No', 'No'),
      [t('Data protection form signed', 'Formulario de protección de datos firmado')]: patientIdsWithDataProtection.value.has(p.id) ? t('Yes', 'Sí') : t('No', 'No'),
      [t('Consent form signed', 'Formulario de consentimiento firmado')]: patientIdsWithConsent.value.has(p.id) ? t('Yes', 'Sí') : t('No', 'No'),
      [t('Status', 'Estado')]: p.status,
      [t('Tags', 'Etiquetas')]: p.tags.join('; '),
      [t('ID', 'ID')]: p.id,
    })),
  )
  const blob = new Blob([csv], { type: 'text/csv' })
  const filename = `patients-export-${new Date().toISOString().slice(0, 10)}-${generatedExports.value.length + 1}.csv`

  generatedExports.value.unshift({
    id: crypto.randomUUID(),
    dataTypeLabel: t('Patients', 'Pacientes'),
    filterSummary: [dateRange.value ? dateRangeLabel.value : null, ...activeFilterLabels.value].filter(Boolean).join(' · ') || t('All patients', 'Todos los pacientes'),
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
    blob,
    filename,
  })
  generating.value = false
  await deliver(blob, filename, () => logExport({ export: 'data_exports', rows: rows.length }))
}

function reshare(exp: GeneratedExport) {
  shareNote.value = null
  deliver(exp.blob, exp.filename)
}

const perPractitioner = computed(() =>
  [...teamMembers.value.map((m) => ({ id: m.id, label: m.full_name })), { id: '__none', label: t('Unassigned', 'Sin asignar') }]
    .map((m) => ({ ...m, count: patients.value.filter((p) => (p.default_practitioner_id ?? '__none') === m.id).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count),
)

const chip = (on: boolean) => ['flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-semibold', on ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700']
</script>

<template>
  <ReportScreen :title="t('Data Exports', 'Exportaciones de datos')" path="/reports/data-exports" :description="t('Export patient data, or find gaps in patient records worth chasing down', 'Exporta datos de pacientes o encuentra huecos en los registros que merezca la pena resolver')">
    <template #filters>
      <span class="shrink-0 pl-1 text-[12px] font-medium text-ink-muted">{{ t('Created', 'Creados') }}</span>
      <button type="button" :class="chip(!dateRange)" :aria-pressed="!dateRange" data-cy="report-data-exports-all-time" @click="dateRange = null">{{ t('All time', 'Todo el tiempo') }}</button>
      <!-- Until a range is chosen the picker would show a preset that is not applied, so it appears only once one is. -->
      <ReportRangePicker v-if="dateRange" v-model="rangeModel" />
      <button v-else type="button" :class="chip(false)" data-cy="report-data-exports-pick-range" @click="dateRange = computePresetRange(STANDARD_PRESETS[1]!)">{{ t('Pick a period', 'Elegir periodo') }}</button>
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ t('The report could not be loaded.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <div v-if="shareNote" class="flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 text-[13.5px] text-ink-700" role="status" data-cy="report-data-exports-share-note">
      <span class="min-w-0 flex-1">{{ shareNote }}</span>
      <AppButton v-if="pendingShare" variant="primary" @click="sharePending">{{ t('Share', 'Compartir') }}</AppButton>
    </div>

    <ReportsModule v-if="!failed" :title="t('Generate New Export', 'Generar nueva exportación')" :description="t('Patients, by created date and any filters below.', 'Pacientes, por fecha de creación y los filtros de abajo.')" :loading="loading" skeleton="list" :rows="6">
      <p class="mt-1 text-[12.5px] text-ink-muted">{{ t('Created', 'Creados') }}: {{ dateRangeLabel }}</p>
      <ul class="mt-1" data-cy="report-data-exports-filters">
        <li v-for="f in FILTERS" :key="f.key" class="border-b border-line-divider last:border-b-0">
          <label class="flex min-h-[48px] items-center gap-3 py-2 text-[14.5px] text-ink-900">
            <span class="min-w-0 flex-1">
              {{ f.label }}
              <span v-if="f.key === 'needs-to-pay' && f.model.value && balancesLoading" class="block text-[12px] text-ink-muted">{{ t('(loading balances…)', '(cargando saldos…)') }}</span>
              <span v-if="f.key === 'needs-to-pay' && f.model.value && balancesFailed" class="block text-[12px] text-danger-text">{{ t("Couldn't load the balances.", 'No se han podido cargar los saldos.') }}</span>
            </span>
            <input v-model="f.model.value" type="checkbox" class="h-5 w-5 shrink-0 rounded border-line-control text-brand focus:ring-brand" :data-cy="`report-data-exports-filter-${f.key}`" />
          </label>
        </li>
      </ul>
      <div class="mt-2 flex items-center gap-2 border-t border-line-divider pt-3">
        <span class="text-[14.5px] text-ink-900">{{ t('Age', 'Edad') }}</span>
        <input v-model="filterAgeMin" type="number" inputmode="numeric" min="0" :placeholder="t('Min', 'Mín.')" :aria-label="t('Minimum age', 'Edad mínima')" class="h-11 w-20 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" />
        <span class="text-ink-faint">–</span>
        <input v-model="filterAgeMax" type="number" inputmode="numeric" min="0" :placeholder="t('Max', 'Máx.')" :aria-label="t('Maximum age', 'Edad máxima')" class="h-11 w-20 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" />
      </div>
      <div class="mt-3 flex flex-col gap-2 border-t border-line-divider pt-3">
        <p class="text-[13px] text-ink-muted" data-cy="report-data-exports-count">{{ t(`${matchingPatients.length} patient${matchingPatients.length === 1 ? '' : 's'} match${matchingPatients.length === 1 ? 'es' : ''} right now`, `${matchingPatients.length} paciente${matchingPatients.length === 1 ? '' : 's'} coincide${matchingPatients.length === 1 ? '' : 'n'} ahora mismo`) }}</p>
        <AppButton variant="primary" :disabled="generating" data-cy="report-data-exports-generate" @click="generateExport">{{ generating ? t('Generating…', 'Generando…') : t('Generate Export', 'Generar exportación') }}</AppButton>
      </div>
    </ReportsModule>

    <ReportsModule v-if="!failed && !loading" :title="t('Generated this session', 'Generado en esta sesión')">
      <p v-if="generatedExports.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No exports generated. To generate a data export, choose from the options above.', 'No se han generado exportaciones. Para generar una exportación de datos, elige entre las opciones anteriores.') }}</p>
      <ul v-else class="mt-1" data-cy="report-data-exports-generated">
        <ReportRow
          v-for="exp in generatedExports"
          :key="exp.id"
          :title="`${exp.dataTypeLabel} — ${t(`${exp.rowCount} row${exp.rowCount === 1 ? '' : 's'}`, `${exp.rowCount} fila${exp.rowCount === 1 ? '' : 's'}`)}`"
          :subtitle="`${exp.filterSummary} · ${new Date(exp.generatedAt).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`"
        >
          <template #trailing>
            <button type="button" class="flex h-11 shrink-0 items-center rounded-ctl border border-line-control px-3 text-[12.5px] font-semibold text-brand-text" @click="reshare(exp)">{{ t('Share CSV', 'Compartir CSV') }}</button>
          </template>
        </ReportRow>
      </ul>
    </ReportsModule>

    <ReportsModule v-if="!failed" :title="t('Patients per practitioner', 'Pacientes por profesional')" :loading="loading" skeleton="list" :rows="4">
      <ul class="mt-1" data-cy="report-data-exports-per-practitioner">
        <ReportRow v-for="row in perPractitioner" :key="row.id" :title="row.label" :value="String(row.count)" />
      </ul>
    </ReportsModule>
  </ReportScreen>
</template>
