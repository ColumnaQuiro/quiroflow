<script setup lang="ts">
// Estadísticas, on the phone: the web's pages/reports/statistics.vue with the
// same data logic -- one all-time load of appointments and appointment types,
// then every count, rate and PVA computed from it exactly as the web does, so
// a tile here is the tile there. Reshaped for a phone: the nine figure tiles
// and the three rates are ReportsStat cards two to a row (three on an iPad),
// and the twelve-month trend keeps its two-axis line chart, a little taller
// than other report charts because its four-series legend sits underneath.
// Left out: the PDF button (no PDF on the app yet) and the link to
// Settings → Appointment Types, which is web-only -- the warning about untagged
// types still names them and says where to tag them.
import { Line } from 'vue-chartjs'
import '../../../utils/chartSetup'
import { computePresetRange, rangeBounds, type DateRange } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { useReportFilterOptions } from '../../../composables/useReportFilterOptions'

definePageMeta({ layout: 'practitioner' })

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
const { canOpen, context, reportsPractitionerId } = useReportAccess()
const locale = computed(() => t('en-GB', 'es-ES'))

const range = ref<DateRange>(computePresetRange({ months: 1 }))
// reports_own_only: pinned to the viewer, with the picker hidden
// (useReportAccess stands in for the web's useOwnScope).
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
// Everything on this page -- counts, rates and PVA -- comes from the
// appointments alone, so there is one load and one flag.
const appointmentsLoading = ref(true)
const failed = ref(false)
// Every appointment, all-time and every status. All-time because the funnel
// metrics need each patient's full history to find the step after the one
// in range; every status because the tiles report what was attended against
// what is still booked, which is the difference the clinic sees when they
// compare this page with their calendar.
const allAppointments = ref<ApptRow[]>([])
const types = ref<TypeRow[]>([])

// None of this depends on the date range -- it is every appointment there has
// ever been -- so it is fetched once, and changing the range only re-computes.
//
// Ordered by id because fetchAllRows asks for its pages in parallel, and
// offset paging is only stable over a stable order.
async function loadAppointments() {
  appointmentsLoading.value = true
  failed.value = false
  try {
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
      // A refused types read would leave every visit stage-less and every
      // figure zero, which reads as a quiet month rather than a failure.
      supabase.from('appointment_types').select('id, name, stage').then((r) => {
        if (r.error) throw r.error
        return (r.data ?? []) as TypeRow[]
      }),
    ])
    const stageOf = new Map(typeRows.map((type) => [type.id, type.stage]))
    allAppointments.value = appts
      .map((a) => ({ ...a, at: Date.parse(a.starts_at), stage: stageOf.get(a.appointment_type_id ?? '') ?? null }))
      .sort((a, b) => a.at - b.at)
    types.value = typeRows
  } catch {
    failed.value = true
  }
  appointmentsLoading.value = false
}

// Only once the role is known to include it: a refused read would come back
// empty and read as a clinic with no visits.
watch(
  () => !!context.value && canOpen('/reports/statistics'),
  (ok) => {
    if (!ok) return
    if (reportsPractitionerId.value) practitionerFilter.value = reportsPractitionerId.value
    loadAppointments()
    loadFilterOptions()
  },
  { immediate: true },
)

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
// range and the one before it. Built once, each one is a lookup.
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
// into. Not euros per visit: a bono session is a visit with no money taken
// at it, so a money-based figure read low for any clinic selling bonos.
const pva = computed(() => pvaIn(rangeStart.value, rangeEnd.value))

// --- Comparison with the period before this one -------------------------
//
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

// What the calendar shows and this page doesn't: a month can read 5 first
// visits here against 9 on the calendar -- 5 attended, 2 still booked later
// in the month, 2 cancelled. Nothing is miscounted; the tile says so.
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

const previousConversionToAdjustment = computed(() => stepConversion('report', 'adjustment', previousRange.value.from, previousRange.value.to))
const previousRetentionToMaintenance = computed(() => stepConversion('revision', 'maintenance', previousRange.value.from, previousRange.value.to))

const previousRangeLabel = computed(() => {
  const fmt = (d: Date) => d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
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

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(locale.value, { month: 'short', year: '2-digit' })
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
// clinic but not for a practitioner limited to their own figures: they cannot
// see anyone else's visits, so every patient who moved to them from a
// colleague would look new.
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
// floor. PVA is dashed so it reads as the odd one out. Legend boxes are
// smaller than Chart.js's default so the four entries take two lines on a
// phone rather than four.
const trendChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  scales: {
    pct: { type: 'linear' as const, position: 'left' as const, beginAtZero: true, max: 100, ticks: { callback: (v: number | string) => `${v}%` } },
    pva: { type: 'linear' as const, position: 'right' as const, beginAtZero: true, grid: { drawOnChartArea: false } },
  },
  plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
}

// Named, not just counted. An untagged type is invisible to every metric on
// this page, and "2 appointment types aren't tagged" gives no clue which --
// when the untagged ones are the revision types, the revision and retention
// figures both read zero while the clinic runs revisions every week.
const unclassifiedTypeNames = computed(() =>
  types.value.filter((type) => !type.stage).map((type) => type.name).sort((a, b) => a.localeCompare(b)),
)
</script>

<template>
  <ReportScreen :title="t('Statistics', 'Estadísticas')" path="/reports/statistics" :description="t('Visit-type counts, conversion, and retention', 'Recuentos por tipo de visita, conversión y retención')">
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :locked-to="reportsPractitionerId" :practitioners="practitioners" :clinics="clinics" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="report-statistics-error">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="loadAppointments">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <p v-if="!appointmentsLoading && !failed && unclassifiedTypeNames.length > 0" class="rounded-card border border-warning-border bg-warning-bg px-3.5 py-3 text-[13px] leading-snug text-warning-text" data-cy="report-statistics-untagged">
      {{ t(
        `Not counted anywhere below, because they have no stage yet: ${unclassifiedTypeNames.join(', ')}. Tag them in Settings → Appointment Types, on the web.`,
        `No se cuentan en nada de lo de abajo, porque todavía no tienen etapa: ${unclassifiedTypeNames.join(', ')}. Asígnala en Ajustes → Tipos de cita, en la web.`,
      ) }}
    </p>

    <p class="px-1 text-[12px] text-ink-faint2">
      {{ t('Counts attended visits. Compared with the same dates a month earlier:', 'Cuenta visitas atendidas. Comparado con las mismas fechas del mes anterior:') }}
      {{ previousRangeLabel }}
    </p>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-3" data-cy="report-statistics-tiles">
      <ReportsStat v-for="tile in tiles" :key="tile.key" :label="tile.label" :loading="appointmentsLoading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" :data-cy="`report-statistics-${tile.key}`">{{ tile.value }}</p>
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
      </ReportsStat>
      <ReportsStat :label="t('PVA (visits / new patient)', 'PVA (visitas / paciente nuevo)')" :loading="appointmentsLoading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-statistics-pva">{{ pva !== null ? pva.toFixed(1) : '—' }}</p>
        <p class="mt-1 text-[11.5px] text-ink-faint2" data-cy="report-statistics-pva-parts">{{ pvaPartsLabel }}</p>
      </ReportsStat>
    </div>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-3" data-cy="report-statistics-rates">
      <ReportsStat :label="t('Conversion to 3rd visit', 'Conversión a 3ª visita')" :loading="appointmentsLoading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-statistics-conversion">{{ conversionToAdjustment ? `${conversionToAdjustment.pct}%` : '—' }}</p>
        <p v-if="conversionToAdjustment" class="text-[12.5px] leading-snug text-ink-faint2">
          {{ t(
            `${conversionToAdjustment.converted} of ${conversionToAdjustment.reached} patients given their report came to a chiropractic adjustment`,
            `${conversionToAdjustment.converted} de ${conversionToAdjustment.reached} pacientes que recibieron su informe vinieron a un ajuste quiropráctico`,
          ) }}
        </p>
        <p v-else class="text-[12.5px] text-ink-faint2">{{ t('No reports given this period.', 'No se ha entregado ningún informe en este periodo.') }}</p>
        <p v-if="previousConversionToAdjustment" class="mt-1 text-[11.5px] text-ink-faint2">
          {{ t(`Previous period: ${previousConversionToAdjustment.pct}%`, `Periodo anterior: ${previousConversionToAdjustment.pct}%`) }}
        </p>
      </ReportsStat>
      <ReportsStat :label="t('Retention post-revision', 'Retención tras revisión')" :loading="appointmentsLoading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-statistics-retention-revision">{{ retentionToMaintenance ? `${retentionToMaintenance.pct}%` : '—' }}</p>
        <p v-if="retentionToMaintenance" class="text-[12.5px] leading-snug text-ink-faint2">
          {{ t(
            `${retentionToMaintenance.converted} of ${retentionToMaintenance.reached} patients at revision 1 went on to a maintenance visit`,
            `${retentionToMaintenance.converted} de ${retentionToMaintenance.reached} pacientes en revisión 1 pasaron a una visita de mantenimiento`,
          ) }}
        </p>
        <p v-else class="text-[12.5px] text-ink-faint2">{{ t('No revision 1 visits this period.', 'No hay visitas de revisión 1 en este periodo.') }}</p>
        <p v-if="previousRetentionToMaintenance" class="mt-1 text-[11.5px] text-ink-faint2">
          {{ t(`Previous period: ${previousRetentionToMaintenance.pct}%`, `Periodo anterior: ${previousRetentionToMaintenance.pct}%`) }}
        </p>
      </ReportsStat>
      <ReportsStat :label="t('Overall retention', 'Retención global')" :loading="appointmentsLoading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-statistics-retention-overall">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</p>
        <p class="text-[12.5px] leading-snug text-ink-faint2">{{ t('Of patients seen this period, % also seen before it', 'Del total de pacientes atendidos en este periodo, % también atendidos antes') }}</p>
      </ReportsStat>
    </div>

    <ReportsModule
      :title="t('Month by month', 'Mes a mes')"
      :description="t(
        'The three rates and PVA, one point per month, over the last 12 months. Not affected by the date range above.',
        'Las tres tasas y el PVA, un punto por mes, durante los últimos 12 meses. No depende del rango de fechas de arriba.',
      )"
      :loading="appointmentsLoading"
      chart-height="h-72"
    >
      <div class="mt-3 h-72" data-cy="report-statistics-trend"><Line :data="trendChartData" :options="trendChartOptions" /></div>
    </ReportsModule>

    <p class="px-1 text-[12px] leading-snug text-ink-faint2">
      {{ t('Package/bono sales are tracked separately — see', 'Las ventas de bonos/paquetes se controlan aparte — consulta') }}
      <NuxtLink to="/reports/debtors" class="underline">{{ t('Debtors', 'Deudores') }}</NuxtLink> {{ t('and', 'y') }}
      <NuxtLink to="/reports/memberships" class="underline">{{ t('Memberships', 'Membresías') }}</NuxtLink>.
    </p>
  </ReportScreen>
</template>
