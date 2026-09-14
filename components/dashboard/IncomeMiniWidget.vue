<script setup lang="ts">
import { classifyPaymentForFilter } from '~/utils/incomeAttribution'
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface PaymentRow { amount_cents: number; paid_at: string; invoice_id: string | null; patient_id: string | null; invoices?: { status: string } | null }
interface InvoiceRow { id: string; total_cents: number; appointment_id: string | null; patient_id: string | null }
interface PatientRow { id: string; default_practitioner_id: string | null; clinic_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const patients = ref<PatientRow[]>([])
const prevPaidCents = ref<number | null>(null)

// Same-length window immediately preceding the selected period, for the KPI
// delta (e.g. selecting "this month" compares against last month).
function previousRange(range: DateRange): { from: Date; to: Date } {
  const { from, to } = rangeBounds(range)
  const spanMs = to.getTime() - from.getTime()
  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - spanMs)
  return { from: prevFrom, to: prevTo }
}

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  const { from: prevFrom, to: prevTo } = previousRange(props.dateRange)
  // The appointments map only exists to resolve a practitioner/clinic
  // filter (see apptMatchesFilter, which short-circuits without one). On an
  // unfiltered dashboard -- how it renders by default -- fetching the whole
  // appointments table meant paging thousands of rows that were never read.
  // load() already re-runs when either filter prop changes, so this can just
  // be skipped rather than lazy-loaded.
  const needsAppointments = !!props.practitionerId || !!props.clinicId

  const [p, inv, appt, pats, prevPayments] = await Promise.all([
    fetchAllRows<PaymentRow>((f, t) =>
      supabase
        .from('payments')
        .select('amount_cents, paid_at, invoice_id, patient_id, invoices(status)')
        .gte('paid_at', from.toISOString())
        .lte('paid_at', to.toISOString())
        .range(f, t),
    ),
    fetchAllRows<InvoiceRow>((f, t) =>
      supabase
        .from('invoices')
        .select('id, total_cents, appointment_id, patient_id')
        .neq('status', 'void')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .range(f, t),
    ),
    needsAppointments
      ? fetchAllRows<AppointmentRow>((f, t) => supabase.from('appointments').select('id, practitioner_id, clinic_id').range(f, t))
      : Promise.resolve([] as AppointmentRow[]),
    // The fallback for money with no appointment behind it -- a bono, credit
    // on account, a quick invoice. Same "only when filtering" reasoning.
    needsAppointments
      ? fetchAllRows<PatientRow>((f, t) => supabase.from('patients').select('id, default_practitioner_id, clinic_id').range(f, t))
      : Promise.resolve([] as PatientRow[]),
    // Only ever summed, never attributed -- the trend line is account-wide.
    fetchAllRows<{ amount_cents: number }>((f, t) =>
      supabase
        .from('payments')
        .select('amount_cents')
        .gte('paid_at', prevFrom.toISOString())
        .lte('paid_at', prevTo.toISOString())
        .range(f, t),
    ),
  ])
  // The void rule moved out of the query when the join went from inner to
  // left: a payment with no invoice has nothing to void and must survive it.
  const notVoid = (row: PaymentRow) => row.invoices?.status !== 'void'
  payments.value = p.filter(notVoid)
  invoices.value = inv
  appointments.value = appt
  patients.value = pats
  prevPaidCents.value = prevPayments.reduce((sum, row) => sum + row.amount_cents, 0)
  loading.value = false
}
onMounted(load)
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))
const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const patientById = computed(() => new Map(patients.value.map((p) => [p.id, p])))

// Money with no appointment behind it falls back to the patient's own
// practitioner -- see utils/incomeAttribution for why, and for what it costs.
function classify(appointmentId: string | null, patientId: string | null) {
  return classifyPaymentForFilter({
    practitionerId: props.practitionerId,
    clinicId: props.clinicId,
    appointment: appointmentId ? (appointmentById.value.get(appointmentId) ?? null) : null,
    patient: patientId ? (patientById.value.get(patientId) ?? null) : null,
  })
}
function appointmentIdOf(invoiceId: string | null): string | null {
  return (invoiceId ? invoiceById.value.get(invoiceId) : undefined)?.appointment_id ?? null
}
const filteredPayments = computed(() => payments.value.filter((p) => classify(appointmentIdOf(p.invoice_id), p.patient_id) === 'matches'))
const filteredInvoices = computed(() => invoices.value.filter((i) => classify(i.appointment_id, i.patient_id) === 'matches'))

const totalPaid = computed(() => filteredPayments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const totalCharged = computed(() => filteredInvoices.value.reduce((sum, i) => sum + i.total_cents, 0))
const outstanding = computed(() => totalCharged.value - totalPaid.value)

// The prior-period comparison is account-wide (not practitioner/clinic
// filtered) -- it's a lightweight trend indicator, not a filtered total.
const deltaPct = computed(() => {
  if (prevPaidCents.value === null || prevPaidCents.value === 0) return null
  return Math.round(((totalPaid.value - prevPaidCents.value) / prevPaidCents.value) * 100)
})

function euros(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div v-if="loading" class="space-y-1.5">
    <UiSkeleton class="h-[27px] w-24 rounded-ctlSm" />
    <UiSkeleton class="h-3 w-40 rounded-ctlSm" />
  </div>
  <div v-else>
    <p class="font-mono text-[27px] leading-none text-ink-900">{{ euros(totalPaid) }}</p>
    <p v-if="deltaPct !== null" class="mt-1.5 text-[12px] font-medium" :class="deltaPct < 0 ? 'text-danger-text' : 'text-success-text'">
      {{ t(`${deltaPct > 0 ? '+' : ''}${deltaPct}% vs previous period`, `${deltaPct > 0 ? '+' : ''}${deltaPct}% frente al periodo anterior`) }}
    </p>
    <div class="mt-2.5 flex items-center gap-4 border-t border-line-row2 pt-2 text-[12px] text-ink-muted2">
      <span>{{ t('Charged', 'Cobrado') }} <span class="font-mono text-ink-700">{{ euros(totalCharged) }}</span></span>
      <span>{{ t('Outstanding', 'Pendiente') }} <span class="font-mono" :class="outstanding > 0 ? 'text-danger-text' : 'text-ink-700'">{{ euros(outstanding) }}</span></span>
    </div>
  </div>
</template>
