<script setup lang="ts">
import { formatEurFromAmount } from '~/utils/billing'
import { Line } from 'vue-chartjs'
import { computePresetRange, monthKeysInRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows, fetchByIds } from '~/composables/useFetchAllRows'
import { isReceipt } from '~/utils/paymentReceipts'
import { classifyPaymentForFilter, practitionerForPayment } from '~/utils/incomeAttribution'

interface PaymentRow { amount_cents: number; method: string; paid_at: string; invoice_id: string | null; patient_id: string | null; invoices?: { status: string } | null }
interface InvoiceRow { id: string; appointment_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
interface PatientRow { id: string; default_practitioner_id: string | null; clinic_id: string | null }
interface TeamMemberRow { id: string; full_name: string; color: string }

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
// reports_own_only: pinned to the viewer, with the picker hidden (useOwnScope).
const { reportsPractitionerId } = useOwnScope()
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
const loading = ref(true)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const patients = ref<PatientRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)

  const [p, inv, tm] = await Promise.all([
    fetchAllRows<PaymentRow>((f, t) =>
      supabase
        .from('payments')
        .select('amount_cents, method, paid_at, invoice_id, patient_id, invoices!payments_invoice_id_fkey(status)')
        .gte('paid_at', from.toISOString())
        .lte('paid_at', to.toISOString())
        .range(f, t),
    ),
    fetchAllRows<InvoiceRow>((f, t) => supabase.from('invoices').select('id, appointment_id').neq('status', 'void').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).range(f, t)),
    supabase.from('team_members').select('id, full_name, color').then((r) => r.data ?? []),
  ])
  // The void rule moved out of the query when the join went from inner to
  // left: a payment with no invoice has nothing to void and must survive it.
  const notVoid = (row: PaymentRow) => row.invoices?.status !== 'void'
  // Credit and write-off rows settle an invoice without money arriving, and
  // this figure is money -- see utils/paymentReceipts. Dropped here rather
  // than at each total, because every number on this widget is takings.
  payments.value = p.filter((row) => notVoid(row) && isReceipt(row.method))
  invoices.value = inv
  teamMembers.value = tm

  // practitionerFor() resolves every payment through its invoice's
  // appointment, so unlike the other reports this page always needs the
  // appointment map -- but only for the invoices actually in range, not the
  // entire appointments table.
  await Promise.all([loadAppointmentsFor(inv), loadPatientsFor(payments.value)])
  loading.value = false
}

async function loadAppointmentsFor(inRangeInvoices: InvoiceRow[]) {
  const ids = [...new Set(inRangeInvoices.map((i) => i.appointment_id).filter((id): id is string => !!id))]
  if (ids.length === 0) {
    appointments.value = []
    return
  }
  // Postgrest puts `in` lists in the URL, so long ranges get chunked.
  appointments.value = await fetchByIds<AppointmentRow>(ids, (chunk) => supabase.from('appointments').select('id, practitioner_id, clinic_id').in('id', chunk))
}
// The patients behind the payments in range -- the answer for money with no
// appointment, which is most of what a bono or credit on account produces.
async function loadPatientsFor(inRangePayments: PaymentRow[]) {
  const ids = [...new Set(inRangePayments.map((p) => p.patient_id).filter((id): id is string => !!id))]
  if (ids.length === 0) {
    patients.value = []
    return
  }
  patients.value = await fetchByIds<PatientRow>(ids, (chunk) => supabase.from('patients').select('id, default_practitioner_id, clinic_id').in('id', chunk))
}

onMounted(() => {
  load()
  loadFilterOptions()
})
watch(range, load)

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
// places a bono or money on account instead of dropping it into __unassigned
// -- that bucket held 8,748 EUR of September against 919 attributed.
function practitionerFor(payment: PaymentRow): string {
  // Shared with reports/income.vue's breakdown, which had its own copy of
  // this chain that stopped at the appointment. Two screens answering "whose
  // money is this" differently is how the same euros read as one
  // practitioner's here and as "Sin asignar" there.
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
  plugins: { legend: { position: 'bottom' as const } },
}

const totalsByPractitioner = computed(() => series.value.map((s) => ({ label: s.label, total: s.data.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total))
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Income Performance', 'Rendimiento de ingresos')" :meta="t('Compare practitioners month over month', 'Compara profesionales mes a mes')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" :locked-to="reportsPractitionerId" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div v-if="loading" class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <UiSkeleton class="h-4 w-56 rounded-ctlSm" />
        <UiSkeleton class="mt-3 h-80 w-full rounded-ctl" />
      </div>
      <div v-else-if="filteredPayments.length === 0" class="mt-6 rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13px] text-ink-faint2">
        {{ t('No payments recorded yet — this fills in once receipts are being paid.', 'Todavía no hay pagos registrados — esto se completará en cuanto se paguen recibos.') }}
      </div>
      <template v-else>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('Revenue by practitioner, by month', 'Ingresos por profesional, por mes') }}</h3>
          <div class="mt-3 h-80"><Line :data="chartData" :options="chartOptions" /></div>
        </div>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('Total over range', 'Total del periodo') }}</h3>
          <ul class="mt-2 space-y-1.5 text-[13px]">
            <li v-for="row in totalsByPractitioner" :key="row.label" class="flex items-center justify-between">
              <span class="text-ink-600">{{ row.label }}</span>
              <span class="font-mono font-medium text-ink-900">{{ formatEurFromAmount(row.total) }}</span>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </div>
</template>
