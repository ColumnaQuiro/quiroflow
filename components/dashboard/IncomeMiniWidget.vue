<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { classifyPaymentForFilter } from '~/utils/incomeAttribution'
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface PaymentRow { amount_cents: number; paid_at: string; invoice_id: string | null; patient_id: string | null; invoices?: { status: string } | null }
interface InvoiceRow { id: string; total_cents: number; status: string; appointment_id: string | null; patient_id: string | null }
interface PatientRow { id: string; default_practitioner_id: string | null; clinic_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const patients = ref<PatientRow[]>([])
const prevPayments = ref<PaymentRow[]>([])
const prevInvoices = ref<InvoiceRow[]>([])
// Every payment against this period's invoices, whenever it was taken -- an
// invoice raised on the 30th is usually settled in the next window, and
// outstanding has to see that money or it reports a debt already paid.
const invoicePayments = ref<{ invoice_id: string | null; amount_cents: number }[]>([])

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

  const [p, inv, appt, pats, prevPaymentRows, prevInvoiceRows] = await Promise.all([
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
        .select('id, total_cents, status, appointment_id, patient_id')
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
    // Classified exactly like the current period. It used to be summed
    // account-wide, which compared one practitioner's takings against the
    // whole clinic's: Jordana Aguar's first month read "-56% vs previous
    // period" -- 2,320 of her own against 5,278 of everyone's -- when she
    // had no previous period at all and had gone from nothing to 2,320.
    fetchAllRows<PaymentRow>((f, t) =>
      supabase
        .from('payments')
        .select('amount_cents, paid_at, invoice_id, patient_id, invoices(status)')
        .gte('paid_at', prevFrom.toISOString())
        .lte('paid_at', prevTo.toISOString())
        .range(f, t),
    ),
    // Only to resolve those payments to an appointment, and so to a
    // practitioner. Never summed: "charged" is about the current period.
    needsAppointments
      ? fetchAllRows<InvoiceRow>((f, t) =>
          supabase
            .from('invoices')
            .select('id, total_cents, status, appointment_id, patient_id')
            .neq('status', 'void')
            .gte('created_at', prevFrom.toISOString())
            .lte('created_at', prevTo.toISOString())
            .range(f, t),
        )
      : Promise.resolve([] as InvoiceRow[]),
  ])
  // The void rule moved out of the query when the join went from inner to
  // left: a payment with no invoice has nothing to void and must survive it.
  const notVoid = (row: PaymentRow) => row.invoices?.status !== 'void'
  payments.value = p.filter(notVoid)
  invoices.value = inv
  appointments.value = appt
  patients.value = pats
  // Same void rule as the current period. It was missing here, so a payment
  // against a voided invoice counted towards the comparison but not towards
  // the figure being compared.
  prevPayments.value = prevPaymentRows.filter(notVoid)
  prevInvoices.value = prevInvoiceRows

  const invoiceIds = inv.map((i) => i.id)
  const allocations: { invoice_id: string | null; amount_cents: number }[] = []
  // Chunked: PostgREST puts an .in() list in the URL, and a busy month's
  // invoices make one long enough to be refused.
  for (let start = 0; start < invoiceIds.length; start += 200) {
    const chunk = invoiceIds.slice(start, start + 200)
    const rows = await fetchAllRows<{ invoice_id: string | null; amount_cents: number }>((f, t) =>
      supabase.from('payments').select('invoice_id, amount_cents').in('invoice_id', chunk).range(f, t),
    )
    allocations.push(...rows)
  }
  invoicePayments.value = allocations
  loading.value = false
}
onMounted(load)
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))
// Both periods' invoices: a previous-period payment resolves to an appointment
// through the invoice it settled, which was raised in that period, not this one.
const invoiceById = computed(() => new Map([...invoices.value, ...prevInvoices.value].map((i) => [i.id, i])))
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
const paidByInvoice = computed(() => {
  const map = new Map<string, number>()
  for (const row of invoicePayments.value) {
    if (!row.invoice_id) continue
    map.set(row.invoice_id, (map.get(row.invoice_id) ?? 0) + row.amount_cents)
  }
  return map
})
const filteredPayments = computed(() => payments.value.filter((p) => classify(appointmentIdOf(p.invoice_id), p.patient_id) === 'matches'))
const filteredInvoices = computed(() => invoices.value.filter((i) => classify(i.appointment_id, i.patient_id) === 'matches'))

const totalPaid = computed(() => filteredPayments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const totalCharged = computed(() => filteredInvoices.value.reduce((sum, i) => sum + i.total_cents, 0))

/**
 * What is still unpaid on the invoices raised in this period.
 *
 * It used to be totalCharged - totalPaid, which is not outstanding anything:
 * the two count different populations, since a payment this month often
 * settles last month's invoice and a bono or money on account is collected
 * against no invoice at all. For this clinic that made it routinely NEGATIVE
 * -- the card read "Outstanding -1054.00" beside 2,320 collected against
 * 1,266 invoiced, which says nothing a person can act on.
 *
 * Measured per invoice against its own payments instead, so it answers "of
 * what we billed in this window, how much has not come in" and can never go
 * below zero.
 *
 * A settled invoice is skipped outright rather than measured, because "has a
 * payment row pointing at it" is not what settled means here and never was.
 * Two whole populations of invoice are paid and always will have none:
 * everything imported from PracticeHub, where the ledger importer carried the
 * invoice across while the money came over as unallocated payments; and every
 * bono session's recibo, which is settled by the bono rather than by a
 * payment -- that is the point of the model. Measuring those found 7,509 EUR
 * of debt in one September, against 272 EUR that was actually owed.
 */
const outstanding = computed(() =>
  filteredInvoices.value
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + Math.max(0, i.total_cents - (paidByInvoice.value.get(i.id) ?? 0)), 0),
)

// Filtered the same way as the figure it is compared against. Comparing a
// practitioner's month against the whole clinic's is not a trend, it is two
// unrelated numbers: it showed -56% for somebody whose takings had gone from
// nothing to 2,320.
const prevPaidCents = computed(() =>
  prevPayments.value
    .filter((p) => classify(appointmentIdOf(p.invoice_id), p.patient_id) === 'matches')
    .reduce((sum, p) => sum + p.amount_cents, 0),
)
const deltaPct = computed(() => {
  // No previous period is not a 100% fall, and saying so about somebody's
  // first month reads as alarm about their best possible result.
  if (prevPaidCents.value === 0) return null
  return Math.round(((totalPaid.value - prevPaidCents.value) / prevPaidCents.value) * 100)
})

function euros(cents: number) {
  return `${formatEur(cents)}`
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
      <!-- "Cobrado" means collected, which is the big number above, not this
      one. This is what was invoiced: facturado. -->
      <span>{{ t('Charged', 'Facturado') }} <span class="font-mono text-ink-700">{{ euros(totalCharged) }}</span></span>
      <span>{{ t('Outstanding', 'Pendiente') }} <span data-test="income-outstanding" class="font-mono" :class="outstanding > 0 ? 'text-danger-text' : 'text-ink-700'">{{ euros(outstanding) }}</span></span>
    </div>
  </div>
</template>
