<script setup lang="ts">
import { Line } from 'vue-chartjs'
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

interface ApptRow {
  id: string
  patient_id: string
  starts_at: string
  status: string
  appointment_type_id: string | null
  practitioner_id: string | null
  clinic_id: string | null
  /** starts_at as epoch ms -- parsed once, not in every comparison below. */
  at: number
  /** The stage of its appointment type, resolved once at load. */
  stage: string | null
}
interface TypeRow { id: string; name: string; stage: string | null }

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
// reports_own_only: pinned to the viewer, with the picker hidden (useOwnScope).
const { reportsPractitionerId } = useOwnScope()
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
// Everything on this page -- counts, rates and PVA -- comes from the
// appointments alone, so there is one load and one flag.
const appointmentsLoading = ref(true)
// Every appointment, all-time and every status. All-time because the funnel
// metrics need each patient's full history to find the step after the one
// in range; every status because the tiles report what was attended against
// what is still booked, which is the difference the clinic sees when they
// compare this page with their calendar.
const allAppointments = ref<ApptRow[]>([])
const types = ref<TypeRow[]>([])

// None of this depends on the date range -- it is every appointment there has
// ever been -- so it is fetched once, and changing the range only re-computes.
// It used to be refetched on every range change, which is the whole table
// again each time, page by page in series.
//
// Ordered by id because fetchAllRows asks for its pages in parallel, and
// offset paging is only stable over a stable order.
async function loadAppointments() {
  appointmentsLoading.value = true
  // Counted alongside the first page, so the other nine-odd pages of a
  // clinic's history go out together rather than four at a time (see
  // fetchAllRows).
  const [appts, typeRows] = await Promise.all([
    fetchAllRows<Omit<ApptRow, 'at' | 'stage'>>(
      (f, to) =>
        supabase
          .from('appointments')
          .select('id, patient_id, starts_at, status, appointment_type_id, practitioner_id, clinic_id')
          .is('deleted_at', null)
          .order('id')
          .range(f, to),
      { total: supabase.from('appointments').select('id', { count: 'exact', head: true }).is('deleted_at', null) },
    ),
    supabase.from('appointment_types').select('id, name, stage').then((r) => (r.data ?? []) as TypeRow[]),
  ])
  const stageOf = new Map(typeRows.map((type) => [type.id, type.stage]))
  allAppointments.value = appts
    .map((a) => ({ ...a, at: Date.parse(a.starts_at), stage: stageOf.get(a.appointment_type_id ?? '') ?? null }))
    .sort((a, b) => a.at - b.at)
  types.value = typeRows
  appointmentsLoading.value = false
}

onMounted(() => {
  loadAppointments()
  loadFilterOptions()
})

// practitioner/clinic filters apply to the full-history set before anything
// else touches it, so every metric below (conversion, retention, ...) is
// automatically scoped without needing its own filter logic.
const filteredAppointments = computed(() => {
  if (!practitionerFilter.value && !clinicFilter.value) return allAppointments.value
  return allAppointments.value.filter((a) => {
    if (practitionerFilter.value && a.practitioner_id !== practitionerFilter.value) return false
    if (clinicFilter.value && a.clinic_id !== clinicFilter.value) return false
    return true
  })
})

// Every metric below this line counts attended visits only -- a booking
// nobody turned up to is not a first visit, and never a conversion.
const filteredCompleted = computed(() => filteredAppointments.value.filter((a) => a.status === 'completed'))

// patient -> stage -> their attended visits at that stage, oldest first.
// The funnel questions below are all "this patient's first X, and did a Y
// follow it", and the chart asks them for twelve months as well as for the
// range and the one before it. Answered by scanning every visit for every
// patient, that was quadratic in the clinic's history and most of the page's
// main-thread time; built once, each one is a lookup.
const completedByPatientStage = computed(() => {
  const index = new Map<string, Map<string, ApptRow[]>>()
  for (const a of filteredCompleted.value) {
    if (!a.stage) continue
    let byStage = index.get(a.patient_id)
    if (!byStage) index.set(a.patient_id, (byStage = new Map()))
    const list = byStage.get(a.stage)
    if (list) list.push(a)
    else byStage.set(a.stage, [a])
  }
  return index
})

const rangeStart = computed(() => rangeBounds(range.value).from)
const rangeEnd = computed(() => rangeBounds(range.value).to)
const inRange = computed(() => {
  const from = rangeStart.value.getTime()
  const to = rangeEnd.value.getTime()
  return filteredCompleted.value.filter((a) => a.at >= from && a.at <= to)
})

function countByStage(stage: string) {
  return inRange.value.filter((a) => a.stage === stage).length
}

const firstVisits = computed(() => countByStage('first_visit'))
const firstVisitOffers = computed(() => countByStage('first_visit_offer'))
// What the practitioner has actually delivered: one completed "report /
// exam findings" visit per informe given.
const reports = computed(() => countByStage('report'))
const adjustments = computed(() => countByStage('adjustment'))
const maintenance = computed(() => countByStage('maintenance'))

// Ordinal revision count needs each patient's FULL history (not just the
// range) to know which occurrence is "1st" vs "2nd" -- then we count how
// many of those land inside the selected range.
function revisionOrdinalsIn(from: Date, to: Date) {
  const inWindow = (a: ApptRow) => a.at >= from.getTime() && a.at <= to.getTime()
  let revision1 = 0
  let revision2 = 0
  for (const byStage of completedByPatientStage.value.values()) {
    const list = byStage.get('revision')
    if (!list) continue
    if (list[0] && inWindow(list[0])) revision1++
    if (list[1] && inWindow(list[1])) revision2++
  }
  return { revision1, revision2 }
}

const revisionOrdinals = computed(() => revisionOrdinalsIn(rangeStart.value, rangeEnd.value))
const previousRevisionOrdinals = computed(() => revisionOrdinalsIn(previousRange.value.from, previousRange.value.to))

// The clinic's funnel, as the clinic describes it:
//
//   primera visita -> informe -> ajuste -> ... -> revisión 1 -> mantenimiento
//
// Both rates below ask the same shape of question: of the patients who
// reached one step inside this range, how many went on to actually attend
// the next one? Attended, not booked -- every appointment counted here is
// already status = 'completed', so a booking nobody turned up to never
// counts as a conversion.
//
// The next step is looked for in the patient's FULL history, not just the
// range: a report given on the 30th converts when the adjustment happens in
// the following month, and that conversion belongs to the report's month.
function stepConversion(fromStage: string, toStage: string, from: Date, to: Date) {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  let reached = 0
  let converted = 0
  for (const byStage of completedByPatientStage.value.values()) {
    const start = byStage.get(fromStage)?.[0] // oldest first, so this is their first
    if (!start || start.at < fromMs || start.at > toMs) continue
    reached++
    if (byStage.get(toStage)?.some((a) => a.at > start.at)) converted++
  }
  if (reached === 0) return null
  return { pct: Math.round((converted / reached) * 100), converted, reached }
}

// "Conversion to 3rd visit": of the patients given their informe in this
// range, how many came back for their first chiropractic adjustment -- the
// visit after the report, third in the sequence above.
const conversionToAdjustment = computed(() => stepConversion('report', 'adjustment', rangeStart.value, rangeEnd.value))

// "Retention post-revision": of the patients who had their revisión 1 in
// this range, how many went on to their first maintenance visit.
//
// Revisión 1 is the patient's first revision-staged visit, which is what
// makes this work for a clinic with one "Revisión" type and for a clinic
// with separate "Revisión 1"/"Revisión 2" types alike.
const retentionToMaintenance = computed(() => stepConversion('revision', 'maintenance', rangeStart.value, rangeEnd.value))

// Overall retention: of patients seen in this range, how many had also
// been seen before it started (i.e. are returning, not brand new).
const retentionRate = computed(() => {
  const beforeRange = new Set(filteredCompleted.value.filter((a) => a.at < rangeStart.value.getTime()).map((a) => a.patient_id))
  const patientsInRange = new Set(inRange.value.map((a) => a.patient_id))
  if (patientsInRange.size === 0) return null
  const returning = [...patientsInRange].filter((id) => beforeRange.has(id)).length
  return Math.round((returning / patientsInRange.size) * 100)
})

// PVA, "patient visit average": visits in the period divided by the new
// patients who started in it -- how many visits each new patient turns
// into. It used to be euros per visit (payments over visits), which is not
// what the clinic means by PVA and read low for anyone whose patients pay
// with bonos: a bono session is a visit with no money taken at it, and the
// bono's own payment is linked to no visit, so September 2026 showed
// Jordana at 28 EUR from 1,545 EUR over 55 visits. The same month is
// 55 visits over 22 new patients: 2.5.
const pva = computed(() => pvaIn(rangeStart.value, rangeEnd.value))

// --- Comparison with the period before this one -------------------------
//
// The same length of time immediately before the selected range, so "this
// month" compares against last month and "last 7 days" against the 7 before
// it. A number on its own says nothing about whether the clinic is doing
// better or worse; this is what turns each tile into a direction.
// The same dates one calendar month earlier: 1-15 Sep compares with
// 1-15 Aug, "last month" with the month before it. A same-length window
// slid back instead (15 days -> the previous 15 days) compared the first
// half of a month with the second half of the one before, which is a
// comparison nobody asked for and reads as noise.
function shiftMonths(d: Date, months: number): Date {
  const shifted = new Date(d)
  shifted.setMonth(shifted.getMonth() + months)
  // Clamp: 31 Mar shifted back a month is 31 Feb, which JS rolls into
  // March. Landing on the last day of the shorter month is what a person
  // means by "the same dates last month".
  if (shifted.getDate() !== d.getDate()) shifted.setDate(0)
  return shifted
}

const previousRange = computed(() => ({
  from: shiftMonths(rangeStart.value, -1),
  to: shiftMonths(rangeEnd.value, -1),
}))

const inPreviousRange = computed(() => {
  const from = previousRange.value.from.getTime()
  const to = previousRange.value.to.getTime()
  return filteredCompleted.value.filter((a) => a.at >= from && a.at <= to)
})

function previousCountByStage(stage: string) {
  return inPreviousRange.value.filter((a) => a.stage === stage).length
}

// null when there is nothing to compare against -- a brand new clinic, or a
// range that reaches back before the clinic's first visit. Showing "+100%"
// against zero would read as growth where there is only a starting point.
function delta(current: number, previous: number): { pct: number; up: boolean } | null {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  return { pct: Math.abs(pct), up: pct >= 0 }
}

interface Tile {
  key: string
  label: string
  value: number
  previous: number
  /** Still in the diary for this range -- the difference between this page and the calendar. */
  booked?: number
  /** Cancelled or no-show in this range: on the calendar, never attended. */
  missed?: number
}

// What the calendar shows and this page doesn't. Natacha's September read 5
// first visits here against 9 on her calendar: 5 attended, 2 still booked
// later in the month, 2 cancelled. Nothing was miscounted -- the page only
// ever said "attended" without saying so.
function stageStatusCounts(stage: string) {
  const from = rangeStart.value.getTime()
  const to = rangeEnd.value.getTime()
  const rows = filteredAppointments.value.filter((a) => a.stage === stage && a.at >= from && a.at <= to)
  return {
    booked: rows.filter((a) => a.status === 'booked').length,
    missed: rows.filter((a) => a.status === 'cancelled' || a.status === 'no_show').length,
  }
}

const tiles = computed<Tile[]>(() => [
  { key: 'first_visit', label: t('First visits', 'Primeras visitas'), value: firstVisits.value, previous: previousCountByStage('first_visit'), ...stageStatusCounts('first_visit') },
  { key: 'first_visit_offer', label: t('First visit offers', 'Ofertas de primera visita'), value: firstVisitOffers.value, previous: previousCountByStage('first_visit_offer'), ...stageStatusCounts('first_visit_offer') },
  { key: 'report', label: t('Reports', 'Informes'), value: reports.value, previous: previousCountByStage('report'), ...stageStatusCounts('report') },
  { key: 'adjustment', label: t('Adjustments', 'Ajustes quiroprácticos'), value: adjustments.value, previous: previousCountByStage('adjustment'), ...stageStatusCounts('adjustment') },
  { key: 'revision1', label: t('Revision 1', 'Revisión 1'), value: revisionOrdinals.value.revision1, previous: previousRevisionOrdinals.value.revision1 },
  { key: 'revision2', label: t('Revision 2', 'Revisión 2'), value: revisionOrdinals.value.revision2, previous: previousRevisionOrdinals.value.revision2 },
  { key: 'maintenance', label: t('Maintenance visits', 'Visitas de mantenimiento'), value: maintenance.value, previous: previousCountByStage('maintenance'), ...stageStatusCounts('maintenance') },
  { key: 'total', label: t('Total completed visits', 'Total de visitas completadas'), value: inRange.value.length, previous: inPreviousRange.value.length },
])

const previousConversionToAdjustment = computed(() =>
  stepConversion('report', 'adjustment', previousRange.value.from, previousRange.value.to),
)
const previousRetentionToMaintenance = computed(() =>
  stepConversion('revision', 'maintenance', previousRange.value.from, previousRange.value.to),
)

const previousRangeLabel = computed(() => {
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${fmt(previousRange.value.from)} – ${fmt(previousRange.value.to)}`
})

// --- Twelve-month trend --------------------------------------------------
//
// Deliberately not tied to the range picker: the tiles answer "how is this
// period doing", and this answers "which way has the clinic been going",
// which needs more than one period to be visible at all.
const TREND_MONTHS = 12

const trendMonthKeys = computed(() => {
  const keys: string[] = []
  const cursor = new Date()
  cursor.setDate(1)
  cursor.setMonth(cursor.getMonth() - (TREND_MONTHS - 1))
  for (let i = 0; i < TREND_MONTHS; i++) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return keys
})

function monthKeyOf(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

// The rates, month by month -- which is the comparison the clinic actually
// wants to look at. Counts already have their own tiles; what a curve adds
// is whether the *percentages* are moving, and PVA alongside them because
// it is what those rates add up to: how many visits a new patient becomes.
//
// Each month is computed the same way the tiles are, just with that month
// as the window, so a point on this chart and the tile for that month agree.
function monthBounds(key: string): { from: Date; to: Date } {
  const [y, m] = key.split('-').map(Number)
  return { from: new Date(y, m - 1, 1, 0, 0, 0, 0), to: new Date(y, m, 0, 23, 59, 59, 999) }
}

function overallRetentionIn(from: Date, to: Date): number | null {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const before = new Set<string>()
  const seen = new Set<string>()
  for (const a of filteredCompleted.value) {
    if (a.at < fromMs) before.add(a.patient_id)
    else if (a.at <= toMs) seen.add(a.patient_id)
  }
  if (seen.size === 0) return null
  return Math.round(([...seen].filter((id) => before.has(id)).length / seen.size) * 100)
}

// A new patient is one who had a first visit -- a "Primera visita" or a
// "Oferta de primera visita" -- in the period: the same visits the First
// visits and First visit offers tiles count, so PVA's denominator is a number
// on this page. Counted as patients, not visits, so the rare patient booked
// into both counts once.
//
// Not "each patient's earliest visit ever", which reads the same on the whole
// clinic (38 against 37 in Sep 2026) but not for a practitioner limited to
// their own figures: they cannot see anyone else's visits, so every patient
// who moved to them from a colleague would look new.
function pvaParts(from: Date, to: Date): { visits: number; newPatients: number } {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  let visits = 0
  const newPatients = new Set<string>()
  for (const a of filteredCompleted.value) {
    if (a.at < fromMs || a.at > toMs) continue
    visits++
    if (a.stage === 'first_visit' || a.stage === 'first_visit_offer') newPatients.add(a.patient_id)
  }
  return { visits, newPatients: newPatients.size }
}

function pvaIn(from: Date, to: Date): number | null {
  const { visits, newPatients } = pvaParts(from, to)
  return newPatients === 0 ? null : visits / newPatients
}
const pvaNow = computed(() => pvaParts(rangeStart.value, rangeEnd.value))
const pvaPartsLabel = computed(() => {
  const { visits, newPatients } = pvaNow.value
  const en = `${visits} ${visits === 1 ? 'visit' : 'visits'} · ${newPatients} new ${newPatients === 1 ? 'patient' : 'patients'}`
  const es = `${visits} ${visits === 1 ? 'visita' : 'visitas'} · ${newPatients} ${newPatients === 1 ? 'paciente nuevo' : 'pacientes nuevos'}`
  return t(en, es)
})

const trendRates = computed(() =>
  trendMonthKeys.value.map((key) => {
    const { from, to } = monthBounds(key)
    return {
      key,
      conversion: stepConversion('report', 'adjustment', from, to)?.pct ?? null,
      retention: stepConversion('revision', 'maintenance', from, to)?.pct ?? null,
      overall: overallRetentionIn(from, to),
      pva: pvaIn(from, to),
    }
  }),
)

const trendChartData = computed(() => ({
  labels: trendMonthKeys.value.map(monthLabel),
  datasets: [
    {
      label: t('Conversion to 3rd visit', 'Conversión a 3ª visita'),
      data: trendRates.value.map((r) => r.conversion),
      borderColor: '#6366f1',
      backgroundColor: '#6366f1',
      tension: 0.3,
      yAxisID: 'pct',
      spanGaps: true,
    },
    {
      label: t('Retention post-revision', 'Retención tras revisión'),
      data: trendRates.value.map((r) => r.retention),
      borderColor: '#22c55e',
      backgroundColor: '#22c55e',
      tension: 0.3,
      yAxisID: 'pct',
      spanGaps: true,
    },
    {
      label: t('Overall retention', 'Retención global'),
      data: trendRates.value.map((r) => r.overall),
      borderColor: '#0ea5e9',
      backgroundColor: '#0ea5e9',
      tension: 0.3,
      yAxisID: 'pct',
      spanGaps: true,
    },
    {
      label: t('PVA (visits per new patient)', 'PVA (visitas por paciente nuevo)'),
      data: trendRates.value.map((r) => (r.pva === null ? null : Number(r.pva.toFixed(1)))),
      borderColor: '#f59e0b',
      backgroundColor: '#f59e0b',
      borderDash: [5, 4],
      tension: 0.3,
      yAxisID: 'pva',
      spanGaps: true,
    },
  ],
}))

// Two axes on purpose: three of these are percentages and one is a count, and
// forcing them onto one scale would flatten whichever is smaller into the
// floor. PVA is dashed so it reads as the odd one out.
const trendChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  scales: {
    pct: { type: 'linear' as const, position: 'left' as const, beginAtZero: true, max: 100, ticks: { callback: (v: number | string) => `${v}%` } },
    pva: { type: 'linear' as const, position: 'right' as const, beginAtZero: true, grid: { drawOnChartArea: false } },
  },
  plugins: { legend: { position: 'bottom' as const } },
}

// Named, not just counted. An untagged type is invisible to every metric on
// this page, and "2 appointment types aren't tagged" gives no clue which --
// on the live account the untagged ones were "Revision 1" and "Revisión 2",
// which is precisely what the revision and retention figures are about, so
// both read zero while the clinic ran revisions every week.
const unclassifiedTypeNames = computed(() =>
  types.value.filter((type) => !type.stage).map((type) => type.name).sort((a, b) => a.localeCompare(b)),
)

// What "Download PDF" reads: the sections below marked data-pdf-block,
// and the figure tiles (components/reports/Stat.vue).
const pdfRoot = ref<HTMLElement | null>(null)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Statistics', 'Estadísticas')" :meta="t('Visit-type counts, conversion, and retention', 'Recuentos por tipo de visita, conversión y retención')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <ReportsPdfButton :target="pdfRoot" :title="t('Statistics', 'Estadísticas')" :range="range" :practitioner-id="practitionerFilter || null" :clinic-id="clinicFilter || null" />
      </div>
    </PageHeader>

    <div ref="pdfRoot" class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <p v-if="!appointmentsLoading && unclassifiedTypeNames.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
        {{ t(
          `Not counted anywhere below, because they have no stage yet: ${unclassifiedTypeNames.join(', ')}. Tag them in`,
          `No se cuentan en nada de lo de abajo, porque todavía no tienen etapa: ${unclassifiedTypeNames.join(', ')}. Asígnala en`,
        ) }}
        <NuxtLink to="/settings/appointment-types" class="font-medium underline">{{ t('Settings → Appointment Types', 'Ajustes → Tipos de cita') }}</NuxtLink>.
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" :locked-to="reportsPractitionerId" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <p class="mt-4 text-[12px] text-ink-faint2">
        {{ t('Counts attended visits. Compared with the same dates a month earlier:', 'Cuenta visitas atendidas. Comparado con las mismas fechas del mes anterior:') }}
        {{ previousRangeLabel }}
      </p>

      <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="tile in tiles" :key="tile.key" class="rounded-card border border-line bg-surface p-4 shadow-card" :aria-busy="appointmentsLoading || undefined">
          <template v-if="appointmentsLoading">
            <div class="flex items-center font-mono text-[23px]" aria-hidden="true">&#8203;<UiSkeleton class="h-[23px] w-12 rounded-ctlSm" /></div>
            <p class="text-[12px] text-ink-muted2">{{ tile.label }}</p>
            <UiSkeleton class="mt-2 h-3 w-20 rounded-ctlSm" />
          </template>
          <template v-else>
            <p class="font-mono text-[23px] font-semibold text-ink-900">{{ tile.value }}</p>
            <p class="text-[12px] text-ink-muted2">{{ tile.label }}</p>
            <p v-if="delta(tile.value, tile.previous)" class="mt-1 text-[11.5px]" :class="delta(tile.value, tile.previous)!.up ? 'text-success-text' : 'text-danger-text'">
              {{ delta(tile.value, tile.previous)!.up ? '▲' : '▼' }} {{ delta(tile.value, tile.previous)!.pct }}%
              <span class="text-ink-faint2">{{ t(`vs ${tile.previous}`, `vs ${tile.previous}`) }}</span>
            </p>
            <p v-else class="mt-1 text-[11.5px] text-ink-faint2">{{ t(`vs ${tile.previous} before`, `vs ${tile.previous} antes`) }}</p>
            <p v-if="tile.booked || tile.missed" class="mt-1 text-[11px] text-ink-faint2">
              <span v-if="tile.booked">{{ t(`+${tile.booked} booked`, `+${tile.booked} reservadas`) }}</span>
              <span v-if="tile.booked && tile.missed"> · </span>
              <span v-if="tile.missed">{{ t(`${tile.missed} cancelled`, `${tile.missed} canceladas`) }}</span>
            </p>
          </template>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card" :aria-busy="appointmentsLoading || undefined">
          <div v-if="appointmentsLoading" class="flex items-center font-mono text-[23px]" aria-hidden="true">&#8203;<UiSkeleton class="h-[23px] w-20 rounded-ctlSm" /></div>
          <p v-else data-test="stats-pva" class="font-mono text-[23px] font-semibold text-ink-900">{{ pva !== null ? pva.toFixed(1) : '—' }}</p>
          <p class="text-[12px] text-ink-muted2">{{ t('PVA (visits / new patient)', 'PVA (visitas / paciente nuevo)') }}</p>
          <p v-if="!appointmentsLoading" data-test="stats-pva-parts" class="mt-1 text-[11.5px] text-ink-faint2">
            {{ pvaPartsLabel }}
          </p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ReportsStat :label="t('Conversion to 3rd visit', 'Conversión a 3ª visita')" :loading="appointmentsLoading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ conversionToAdjustment ? `${conversionToAdjustment.pct}%` : '—' }}</p>
          <p v-if="conversionToAdjustment" class="text-[12px] text-ink-faint2">
            {{ t(
              `${conversionToAdjustment.converted} of ${conversionToAdjustment.reached} patients given their report came to a chiropractic adjustment`,
              `${conversionToAdjustment.converted} de ${conversionToAdjustment.reached} pacientes que recibieron su informe vinieron a un ajuste quiropráctico`,
            ) }}
          </p>
          <p v-else class="text-[12px] text-ink-faint2">{{ t('No reports given this period.', 'No se ha entregado ningún informe en este periodo.') }}</p>
          <p v-if="previousConversionToAdjustment" class="mt-1 text-[11.5px] text-ink-faint2">
            {{ t(`Previous period: ${previousConversionToAdjustment.pct}%`, `Periodo anterior: ${previousConversionToAdjustment.pct}%`) }}
          </p>
        </ReportsStat>
        <ReportsStat :label="t('Retention post-revision', 'Retención tras revisión')" :loading="appointmentsLoading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ retentionToMaintenance ? `${retentionToMaintenance.pct}%` : '—' }}</p>
          <p v-if="retentionToMaintenance" class="text-[12px] text-ink-faint2">
            {{ t(
              `${retentionToMaintenance.converted} of ${retentionToMaintenance.reached} patients at revision 1 went on to a maintenance visit`,
              `${retentionToMaintenance.converted} de ${retentionToMaintenance.reached} pacientes en revisión 1 pasaron a una visita de mantenimiento`,
            ) }}
          </p>
          <p v-else class="text-[12px] text-ink-faint2">{{ t('No revision 1 visits this period.', 'No hay visitas de revisión 1 en este periodo.') }}</p>
          <p v-if="previousRetentionToMaintenance" class="mt-1 text-[11.5px] text-ink-faint2">
            {{ t(`Previous period: ${previousRetentionToMaintenance.pct}%`, `Periodo anterior: ${previousRetentionToMaintenance.pct}%`) }}
          </p>
        </ReportsStat>
        <ReportsStat :label="t('Overall retention', 'Retención global')" :loading="appointmentsLoading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('Of patients seen this period, % also seen before it', 'Del total de pacientes atendidos en este periodo, % también atendidos antes') }}</p>
        </ReportsStat>
      </div>

      <ReportsModule
        class="mt-4"
        :title="t('Month by month', 'Mes a mes')"
        :description="t(
          'The three rates and PVA, one point per month, over the last 12 months. Not affected by the date range above.',
          'Las tres tasas y el PVA, un punto por mes, durante los últimos 12 meses. No depende del rango de fechas de arriba.',
        )"
        :loading="appointmentsLoading"
        chart-height="h-80"
      >
        <div class="mt-3 h-80"><Line :data="trendChartData" :options="trendChartOptions" /></div>
      </ReportsModule>

      <p class="mt-4 text-[12px] text-ink-faint2">
        {{ t('Package/bono sales are tracked separately — see', 'Las ventas de bonos/paquetes se controlan aparte — consulta') }}
        <NuxtLink to="/reports/debtors" class="underline hover:text-ink-600">{{ t('Debtors', 'Deudores') }}</NuxtLink> {{ t('and', 'y') }}
        <NuxtLink to="/reports/memberships" class="underline hover:text-ink-600">{{ t('Memberships', 'Membresías') }}</NuxtLink>.
      </p>
    </div>
  </div>
</template>
