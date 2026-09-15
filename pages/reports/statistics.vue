<script setup lang="ts">
import { Line } from 'vue-chartjs'
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import type { Database } from '~/types/database.types'

interface ApptRow { id: string; patient_id: string; starts_at: string; appointment_type_id: string | null; practitioner_id: string | null; clinic_id: string | null }
interface TypeRow { id: string; name: string; stage: string | null }
interface PaymentRow { amount_cents: number; paid_at: string; invoice_id: string }
interface InvoiceRow { id: string; appointment_id: string | null }

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
const practitionerFilter = ref('')
const clinicFilter = ref('')
const loading = ref(true)
const allCompleted = ref<ApptRow[]>([]) // every completed appointment, all-time — several metrics need full patient history
const types = ref<TypeRow[]>([])
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])

const PAGE_SIZE = 1000
async function fetchAll<T>(table: keyof Database['public']['Tables'], select: string, filter?: (q: any) => any): Promise<T[]> {
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
  const [completed, typeRows] = await Promise.all([
    fetchAll<ApptRow>('appointments', 'id, patient_id, starts_at, appointment_type_id, practitioner_id, clinic_id', (q) => q.eq('status', 'completed')),
    supabase.from('appointment_types').select('id, name, stage').then((r) => r.data ?? []),
  ])
  allCompleted.value = completed.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  types.value = typeRows

  const { from, to } = rangeBounds(range.value)
  const [p, inv] = await Promise.all([
    fetchAll<PaymentRow>('payments', 'amount_cents, paid_at, invoice_id', (q) => q.gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString())),
    fetchAll<InvoiceRow>('invoices', 'id, appointment_id', (q) => q.gte('created_at', from.toISOString()).lte('created_at', to.toISOString())),
  ])
  payments.value = p
  invoices.value = inv

  loading.value = false
}
onMounted(() => {
  load()
  loadFilterOptions()
})
watch(range, load)

const stageById = computed(() => new Map(types.value.map((t) => [t.id, t.stage])))

// practitioner/clinic filters apply to the full-history set before anything
// else touches it, so every metric below (conversion, retention, ...) is
// automatically scoped without needing its own filter logic.
const filteredCompleted = computed(() => {
  if (!practitionerFilter.value && !clinicFilter.value) return allCompleted.value
  return allCompleted.value.filter((a) => {
    if (practitionerFilter.value && a.practitioner_id !== practitionerFilter.value) return false
    if (clinicFilter.value && a.clinic_id !== clinicFilter.value) return false
    return true
  })
})

const rangeStart = computed(() => rangeBounds(range.value).from)
const rangeEnd = computed(() => rangeBounds(range.value).to)
const inRange = computed(() => filteredCompleted.value.filter((a) => new Date(a.starts_at) >= rangeStart.value && new Date(a.starts_at) <= rangeEnd.value))

function countByStage(stage: string) {
  return inRange.value.filter((a) => stageById.value.get(a.appointment_type_id ?? '') === stage).length
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
  const byPatient = new Map<string, ApptRow[]>()
  for (const a of filteredCompleted.value) {
    if (stageById.value.get(a.appointment_type_id ?? '') !== 'revision') continue
    const list = byPatient.get(a.patient_id) ?? []
    list.push(a)
    byPatient.set(a.patient_id, list)
  }
  const inWindow = (a: ApptRow) => new Date(a.starts_at) >= from && new Date(a.starts_at) <= to
  let revision1 = 0
  let revision2 = 0
  for (const list of byPatient.values()) {
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
function firstOfStageAfter(patientId: string, stage: string, after: string): ApptRow | undefined {
  return filteredCompleted.value.find(
    (a) => a.patient_id === patientId && stageById.value.get(a.appointment_type_id ?? '') === stage && a.starts_at > after,
  )
}

function stepConversion(fromStage: string, toStage: string, from: Date, to: Date) {
  const startByPatient = new Map<string, ApptRow>()
  for (const a of filteredCompleted.value) {
    if (stageById.value.get(a.appointment_type_id ?? '') !== fromStage) continue
    if (startByPatient.has(a.patient_id)) continue // ascending order, so this keeps their first
    startByPatient.set(a.patient_id, a)
  }
  const reached = [...startByPatient.entries()].filter(([, a]) => new Date(a.starts_at) >= from && new Date(a.starts_at) <= to)
  if (reached.length === 0) return null
  const converted = reached.filter(([patientId, step]) => firstOfStageAfter(patientId, toStage, step.starts_at)).length
  return { pct: Math.round((converted / reached.length) * 100), converted, reached: reached.length }
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
  const beforeRange = new Set(filteredCompleted.value.filter((a) => new Date(a.starts_at) < rangeStart.value).map((a) => a.patient_id))
  const patientsInRange = new Set(inRange.value.map((a) => a.patient_id))
  if (patientsInRange.size === 0) return null
  const returning = [...patientsInRange].filter((id) => beforeRange.has(id)).length
  return Math.round((returning / patientsInRange.size) * 100)
})

const appointmentById = computed(() => new Map(allCompleted.value.map((a) => [a.id, a])))
const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const filteredPayments = computed(() => {
  if (!practitionerFilter.value && !clinicFilter.value) return payments.value
  return payments.value.filter((p) => {
    const appt = appointmentById.value.get(invoiceById.value.get(p.invoice_id)?.appointment_id ?? '')
    if (!appt) return false
    if (practitionerFilter.value && appt.practitioner_id !== practitionerFilter.value) return false
    if (clinicFilter.value && appt.clinic_id !== clinicFilter.value) return false
    return true
  })
})

const pva = computed(() => {
  const totalCents = filteredPayments.value.reduce((sum, p) => sum + p.amount_cents, 0)
  if (inRange.value.length === 0) return null
  return totalCents / 100 / inRange.value.length
})

// --- Comparison with the period before this one -------------------------
//
// The same length of time immediately before the selected range, so "this
// month" compares against last month and "last 7 days" against the 7 before
// it. A number on its own says nothing about whether the clinic is doing
// better or worse; this is what turns each tile into a direction.
const previousRange = computed(() => {
  const from = rangeStart.value
  const to = rangeEnd.value
  const span = to.getTime() - from.getTime()
  return { from: new Date(from.getTime() - span - 1), to: new Date(from.getTime() - 1) }
})

const inPreviousRange = computed(() =>
  filteredCompleted.value.filter((a) => {
    const at = new Date(a.starts_at)
    return at >= previousRange.value.from && at <= previousRange.value.to
  }),
)

function previousCountByStage(stage: string) {
  return inPreviousRange.value.filter((a) => stageById.value.get(a.appointment_type_id ?? '') === stage).length
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
}

const tiles = computed<Tile[]>(() => [
  { key: 'first_visit', label: t('First visits', 'Primeras visitas'), value: firstVisits.value, previous: previousCountByStage('first_visit') },
  { key: 'first_visit_offer', label: t('First visit offers', 'Ofertas de primera visita'), value: firstVisitOffers.value, previous: previousCountByStage('first_visit_offer') },
  { key: 'report', label: t('Reports', 'Informes'), value: reports.value, previous: previousCountByStage('report') },
  { key: 'adjustment', label: t('Adjustments', 'Ajustes quiroprácticos'), value: adjustments.value, previous: previousCountByStage('adjustment') },
  { key: 'revision1', label: t('Revision 1', 'Revisión 1'), value: revisionOrdinals.value.revision1, previous: previousRevisionOrdinals.value.revision1 },
  { key: 'revision2', label: t('Revision 2', 'Revisión 2'), value: revisionOrdinals.value.revision2, previous: previousRevisionOrdinals.value.revision2 },
  { key: 'maintenance', label: t('Maintenance visits', 'Visitas de mantenimiento'), value: maintenance.value, previous: previousCountByStage('maintenance') },
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

const TREND_SERIES = computed(() => [
  { stage: 'first_visit', label: t('First visits', 'Primeras visitas'), color: '#6366f1' },
  { stage: 'report', label: t('Reports', 'Informes'), color: '#0ea5e9' },
  { stage: 'adjustment', label: t('Adjustments', 'Ajustes'), color: '#22c55e' },
  { stage: 'maintenance', label: t('Maintenance', 'Mantenimiento'), color: '#f59e0b' },
])

const trendChartData = computed(() => {
  const counts = new Map<string, Map<string, number>>()
  for (const a of filteredCompleted.value) {
    const stage = stageById.value.get(a.appointment_type_id ?? '')
    if (!stage) continue
    const key = monthKeyOf(a.starts_at)
    const forStage = counts.get(stage) ?? new Map<string, number>()
    forStage.set(key, (forStage.get(key) ?? 0) + 1)
    counts.set(stage, forStage)
  }
  return {
    labels: trendMonthKeys.value.map(monthLabel),
    datasets: TREND_SERIES.value.map((serie) => ({
      label: serie.label,
      data: trendMonthKeys.value.map((key) => counts.get(serie.stage)?.get(key) ?? 0),
      borderColor: serie.color,
      backgroundColor: serie.color,
      tension: 0.3,
    })),
  }
})

const trendChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true } },
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
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Statistics', 'Estadísticas')" :meta="t('Visit-type counts, conversion, and retention', 'Recuentos por tipo de visita, conversión y retención')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p v-if="!loading && unclassifiedTypeNames.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
        {{ t(
          `Not counted anywhere below, because they have no stage yet: ${unclassifiedTypeNames.join(', ')}. Tag them in`,
          `No se cuentan en nada de lo de abajo, porque todavía no tienen etapa: ${unclassifiedTypeNames.join(', ')}. Asígnala en`,
        ) }}
        <NuxtLink to="/settings/appointment-types" class="font-medium underline">{{ t('Settings → Appointment Types', 'Ajustes → Tipos de cita') }}</NuxtLink>.
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div v-if="loading" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="i in 4" :key="i" class="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
          <UiSkeleton class="h-[23px] w-12 rounded-ctlSm" />
          <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
        </div>
      </div>

      <template v-else>
        <p class="mt-4 text-[12px] text-ink-faint2">
          {{ t('Compared with the same length of time just before it:', 'Comparado con el mismo periodo justo anterior:') }} {{ previousRangeLabel }}
        </p>

        <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div v-for="tile in tiles" :key="tile.key" class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="font-mono text-[23px] font-semibold text-ink-900">{{ tile.value }}</p>
            <p class="text-[12px] text-ink-muted2">{{ tile.label }}</p>
            <p v-if="delta(tile.value, tile.previous)" class="mt-1 text-[11.5px]" :class="delta(tile.value, tile.previous)!.up ? 'text-success-text' : 'text-danger-text'">
              {{ delta(tile.value, tile.previous)!.up ? '▲' : '▼' }} {{ delta(tile.value, tile.previous)!.pct }}%
              <span class="text-ink-faint2">{{ t(`vs ${tile.previous}`, `vs ${tile.previous}`) }}</span>
            </p>
            <p v-else class="mt-1 text-[11.5px] text-ink-faint2">{{ t(`vs ${tile.previous} before`, `vs ${tile.previous} antes`) }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="font-mono text-[23px] font-semibold text-ink-900">{{ pva !== null ? `€${pva.toFixed(2)}` : '—' }}</p>
            <p class="text-[12px] text-ink-muted2">{{ t('PVA (avg. revenue / visit)', 'PVA (ingreso medio / visita)') }}</p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Conversion to 3rd visit', 'Conversión a 3ª visita') }}</p>
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
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Retention post-revision', 'Retención tras revisión') }}</p>
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
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Overall retention', 'Retención global') }}</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</p>
            <p class="text-[12px] text-ink-faint2">{{ t('Of patients seen this period, % also seen before it', 'Del total de pacientes atendidos en este periodo, % también atendidos antes') }}</p>
          </div>
        </div>

        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('Last 12 months', 'Últimos 12 meses') }}</h3>
          <p class="text-[12px] text-ink-faint2">
            {{ t('Completed visits per month. Not affected by the date range above.', 'Visitas completadas por mes. No depende del rango de fechas de arriba.') }}
          </p>
          <div class="mt-3 h-80"><Line :data="trendChartData" :options="trendChartOptions" /></div>
        </div>

        <p class="mt-4 text-[12px] text-ink-faint2">
          {{ t('Package/bono sales are tracked separately — see', 'Las ventas de bonos/paquetes se controlan aparte — consulta') }}
          <NuxtLink to="/reports/debtors" class="underline hover:text-ink-600">{{ t('Debtors', 'Deudores') }}</NuxtLink> {{ t('and', 'y') }}
          <NuxtLink to="/reports/memberships" class="underline hover:text-ink-600">{{ t('Memberships', 'Membresías') }}</NuxtLink>.
        </p>
      </template>
    </div>
  </div>
</template>
