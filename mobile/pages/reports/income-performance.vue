<script setup lang="ts">
// Rendimiento de ingresos, on the phone: the web's
// pages/reports/income-performance.vue with the same two embedded reads, the
// same void and receipt rules and the same attribution chain
// (practitionerForPayment, classifyPaymentForFilter), so a practitioner's
// month here is that month there. The chart keeps its one line per
// practitioner (legend at the bottom). Reshaped for a phone: a point on a
// 375 px chart is hard to read, so the practitioner x month figures it draws
// are also listed, with a month chip ("Todo el periodo" or one month) over
// one row per practitioner in their chart colour; picking a month also shows
// what each had the month before, which is the step the curve shows. Left
// out: the PDF button (no PDF on the app yet).
import { formatEurFromAmount } from '../../../utils/billing'
import { Line } from 'vue-chartjs'
import '../../../utils/chartSetup'
import { computePresetRange, monthKeysInRange, rangeBounds } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { isReceipt } from '../../../utils/paymentReceipts'
import { classifyPaymentForFilter, practitionerForPayment } from '../../../utils/incomeAttribution'

definePageMeta({ layout: 'practitioner' })

interface PaymentRow { amount_cents: number; method: string; paid_at: string; invoice_id: string | null; patient_id: string | null; invoices?: { status: string } | null }
interface InvoiceRow { id: string; appointment_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
interface PatientRow { id: string; default_practitioner_id: string | null; clinic_id: string | null }
interface TeamMemberRow { id: string; full_name: string; color: string }

const PATH = '/reports/income-performance'
const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()
const { canOpen, context, reportsPractitionerId } = useReportAccess()

const range = ref(computePresetRange({ months: 1 }))
// reports_own_only: pinned to the viewer, with the picker replaced by a pill
// (ReportPeopleFilters pins it too; this covers the first computation).
const practitionerFilter = ref('')
const clinicFilter = ref('')
watch(reportsPractitionerId, (id) => { if (id) practitionerFilter.value = id }, { immediate: true })
const loading = ref(true)
const failed = ref(false)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const patients = ref<PatientRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])

// A range picked while this is in flight starts another run; only the latest
// may write, or a slow earlier answer lands over the newer one.
let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  const { from, to } = rangeBounds(range.value)

  // Two requests side by side, each carrying what attribution reads off it:
  // the payments their patient (the answer for money with no visit behind
  // it), the invoices their appointment (the answer for money that has one).
  // Appointments are reached only through the invoices in range, and
  // patients only through the payments in range.
  type EmbeddedPayment = PaymentRow & { patients: PatientRow | null }
  type EmbeddedInvoice = InvoiceRow & { appointments: AppointmentRow | null }
  const result = await Promise.all([
    fetchAllRows<EmbeddedPayment>(
      (f, t) =>
        supabase
          .from('payments')
          .select('amount_cents, method, paid_at, invoice_id, patient_id, invoices!payments_invoice_id_fkey(status), patients!payments_patient_id_fkey(id, default_practitioner_id, clinic_id)')
          .gte('paid_at', from.toISOString())
          .lte('paid_at', to.toISOString())
          .range(f, t) as unknown as PromiseLike<{ data: EmbeddedPayment[] | null; error: unknown }>,
    ),
    fetchAllRows<EmbeddedInvoice>(
      (f, t) =>
        supabase
          .from('invoices')
          .select('id, appointment_id, appointments!invoices_appointment_id_fkey(id, practitioner_id, clinic_id)')
          .neq('status', 'void')
          .gte('created_at', from.toISOString())
          .lte('created_at', to.toISOString())
          .range(f, t) as unknown as PromiseLike<{ data: EmbeddedInvoice[] | null; error: unknown }>,
    ),
    // Not tied to the range, but tiny, and a missing name list would draw
    // every line as "Sin asignar": read with the money, and fail with it.
    teamMembers.value.length ? Promise.resolve(teamMembers.value) : supabase.from('team_members').select('id, full_name, color').then((r) => {
      if (r.error) throw r.error
      return (r.data ?? []) as TeamMemberRow[]
    }),
  ]).catch(() => null)
  if (mine !== run) return
  // A refused read is not "no income": say so instead of drawing zeros.
  if (!result) {
    failed.value = true
    loading.value = false
    return
  }
  const [p, inv, team] = result
  // The void rule moved out of the query when the join went from inner to
  // left: a payment with no invoice has nothing to void and must survive it.
  const notVoid = (row: PaymentRow) => row.invoices?.status !== 'void'
  // Credit and write-off rows settle an invoice without money arriving, and
  // this figure is money -- see utils/paymentReceipts. Dropped here rather
  // than at each total, because every number on this report is takings.
  const inRangePayments = p.filter((row) => notVoid(row) && isReceipt(row.method))

  const appointmentById = new Map<string, AppointmentRow>()
  for (const i of inv) if (i.appointments) appointmentById.set(i.appointments.id, i.appointments)
  const patientById = new Map<string, PatientRow>()
  for (const row of inRangePayments) if (row.patients) patientById.set(row.patients.id, row.patients)

  // All at once, so the chart never draws this range's money against the
  // last range's appointments.
  payments.value = inRangePayments.map(({ patients: _patient, ...row }) => row)
  invoices.value = inv.map(({ appointments: _appointment, ...row }) => row)
  appointments.value = [...appointmentById.values()]
  patients.value = [...patientById.values()]
  teamMembers.value = team
  loading.value = false
}

// Only once the role is known to include it: a refused read would come back
// empty and read as "no income".
watch(() => !!context.value && canOpen(PATH), (ok) => {
  if (!ok) return
  load()
  loadFilterOptions()
}, { immediate: true })
watch(range, () => { if (context.value && canOpen(PATH)) load() })

const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))
const patientById = computed(() => new Map(patients.value.map((p) => [p.id, p])))

function appointmentFor(payment: PaymentRow) {
  const invoice = payment.invoice_id ? invoiceById.value.get(payment.invoice_id) : undefined
  return invoice?.appointment_id ? (appointmentById.value.get(invoice.appointment_id) ?? null) : null
}
const filteredPayments = computed(() =>
  payments.value.filter(
    (p) =>
      classifyPaymentForFilter({
        practitionerId: practitionerFilter.value || undefined,
        clinicId: clinicFilter.value || undefined,
        appointment: appointmentFor(p),
        patient: p.patient_id ? (patientById.value.get(p.patient_id) ?? null) : null,
      }) === 'matches',
  ),
)

function monthKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}
const monthKeys = computed(() => monthKeysInRange(range.value))

// Whose line this payment lands on. The appointment first, since that is who
// actually did the work; then the patient's own practitioner, which is what
// places a bono or money on account instead of dropping it into __unassigned.
// Shared with reports/income.vue's breakdown: two screens answering "whose
// money is this" differently is how the same euros read as one
// practitioner's here and as "Sin asignar" there.
function practitionerFor(payment: PaymentRow): string {
  return (
    practitionerForPayment({
      appointment: appointmentFor(payment) ?? null,
      patient: (payment.patient_id ? patientById.value.get(payment.patient_id) : undefined) ?? null,
    }) ?? '__unassigned'
  )
}

const series = computed(() => {
  const byPractitioner = new Map<string, Map<string, number>>()
  for (const p of filteredPayments.value) {
    const key = practitionerFor(p)
    const monthTotals = byPractitioner.get(key) ?? new Map<string, number>()
    const mk = monthKey(p.paid_at)
    monthTotals.set(mk, (monthTotals.get(mk) ?? 0) + p.amount_cents)
    byPractitioner.set(key, monthTotals)
  }
  return [...byPractitioner.entries()].map(([id, monthTotals]) => {
    const member = teamMembers.value.find((m) => m.id === id)
    return {
      id,
      label: member?.full_name ?? t('Unassigned', 'Sin asignar'),
      color: member?.color ?? '#9ca3af',
      data: monthKeys.value.map((k) => (monthTotals.get(k) ?? 0) / 100),
    }
  })
})

const chartData = computed(() => ({
  labels: monthKeys.value.map(monthLabel),
  datasets: series.value.map((s) => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color, tension: 0.3 })),
}))
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true } },
  plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 10, font: { size: 11 } } } },
}

// The figures the chart draws, as a list. '' is the whole range (the web's
// "Total over range"); a month key reads that month's point off each line.
const month = ref('')
const monthOptions = computed(() => monthKeys.value.map((k) => ({ id: k, name: monthLabel(k) })))
watch(monthKeys, (keys) => { if (month.value && !keys.includes(month.value)) month.value = '' })

// Keyed by practitioner id, not by label: until the team's names arrive every
// series is labelled "Unassigned", and a list keyed by a label four rows
// share leaves stale rows behind when the names land.
const rows = computed(() => {
  const index = month.value ? monthKeys.value.indexOf(month.value) : -1
  return series.value
    .map((s) => ({
      id: s.id,
      label: s.label,
      color: s.color,
      total: index >= 0 ? s.data[index] : s.data.reduce((a, b) => a + b, 0),
      previous: index > 0 ? s.data[index - 1] : null,
    }))
    .sort((a, b) => b.total - a.total)
})
const previousMonthLabel = computed(() => {
  const index = month.value ? monthKeys.value.indexOf(month.value) : -1
  return index > 0 ? monthLabel(monthKeys.value[index - 1]) : null
})
function previousNote(previous: number | null): string | null {
  if (previous == null || !previousMonthLabel.value) return null
  return `${previousMonthLabel.value}: ${formatEurFromAmount(previous)}`
}
</script>

<template>
  <ReportScreen :title="t('Income Performance', 'Rendimiento de ingresos')" :path="PATH" :description="t('Compare practitioners month over month', 'Compara profesionales mes a mes')">
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :locked-to="reportsPractitionerId" :practitioners="practitioners" :clinics="clinics" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="report-income-performance-error">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 min-h-[44px] font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <div v-else-if="!loading && filteredPayments.length === 0" class="rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13.5px] text-ink-faint" data-cy="report-income-performance-empty">
      {{ t('No payments recorded yet — this fills in once receipts are being paid.', 'Todavía no hay pagos registrados — esto se completará en cuanto se paguen recibos.') }}
    </div>

    <template v-else>
      <ReportsModule :title="t('Revenue by practitioner, by month', 'Ingresos por profesional, por mes')" :loading="loading" chart-height="h-64">
        <div class="mt-3 h-64" data-cy="report-income-performance-chart"><Line :data="chartData" :options="chartOptions" /></div>
      </ReportsModule>

      <ReportsModule :title="month ? t('By practitioner, one month', 'Por profesional, un mes') : t('Total over range', 'Total del periodo')" :loading="loading" skeleton="list" :rows="3">
        <div v-if="monthOptions.length > 1" class="mt-2 flex">
          <ReportSelect v-model="month" :options="monthOptions" :all-label="t('Whole range', 'Todo el periodo')" :label="t('Month', 'Mes')" data-cy="report-income-performance-month" />
        </div>
        <ul class="mt-1" data-cy="report-income-performance-totals">
          <ReportRow
            v-for="row in rows"
            :key="row.id"
            :title="row.label"
            :value="formatEurFromAmount(row.total)"
            :value-note="previousNote(row.previous)"
          >
            <template #leading>
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" aria-hidden="true" />
            </template>
          </ReportRow>
        </ul>
      </ReportsModule>
    </template>
  </ReportScreen>
</template>
