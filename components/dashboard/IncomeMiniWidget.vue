<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { classifyPaymentForFilter } from '~/utils/incomeAttribution'
import { isReceipt } from '~/utils/paymentReceipts'
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface PaymentRow { amount_cents: number; method: string; paid_at: string; invoice_id: string | null; patient_id: string | null; invoices?: { status: string } | null }
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
const latest = useLatestRun()

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
  const isStale = latest.start()
  loading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  const { from: prevFrom, to: prevTo } = previousRange(props.dateRange)
  const needsAppointments = !!props.practitionerId || !!props.clinicId

  // Whose money each payment and invoice is travels with it: the patient it
  // was taken from, and (through its invoice) the visit behind it. With a
  // practitioner picked this widget used to download the ENTIRE appointments
  // and patients tables to look those up -- ten-odd requests for a clinic
  // with 9,000 appointments -- and every payment against the period's
  // invoices came in a further round after the rest. The lookups read the
  // same rows either way: an invoice's appointment is only ever asked for
  // through an invoice in one of the two periods, a patient only through a
  // payment or invoice on screen.
  type Embedded<T> = T & { patients?: PatientRow | null; appointments?: AppointmentRow | null; payments?: { invoice_id: string | null; amount_cents: number }[] }
  const paymentColumns = `amount_cents, method, paid_at, invoice_id, patient_id, invoices!payments_invoice_id_fkey(status)${needsAppointments ? ', patients!payments_patient_id_fkey(id, default_practitioner_id, clinic_id)' : ''}`
  const invoiceColumns = (withPayments: boolean) =>
    `id, total_cents, status, appointment_id, patient_id${needsAppointments ? ', appointments!invoices_appointment_id_fkey(id, practitioner_id, clinic_id), patients!invoices_patient_id_fkey(id, default_practitioner_id, clinic_id)' : ''}${withPayments ? ', payments!payments_invoice_id_fkey(invoice_id, amount_cents)' : ''}`
  const paymentsIn = (a: Date, b: Date) =>
    fetchAllRows<Embedded<PaymentRow>>(
      (f, t) =>
        supabase.from('payments').select(paymentColumns).gte('paid_at', a.toISOString()).lte('paid_at', b.toISOString()).range(f, t) as unknown as PromiseLike<{ data: Embedded<PaymentRow>[] | null; error: unknown }>,
    )
  const invoicesIn = (a: Date, b: Date, withPayments: boolean) =>
    fetchAllRows<Embedded<InvoiceRow>>(
      (f, t) =>
        supabase
          .from('invoices')
          .select(invoiceColumns(withPayments))
          .neq('status', 'void')
          .gte('created_at', a.toISOString())
          .lte('created_at', b.toISOString())
          .range(f, t) as unknown as PromiseLike<{ data: Embedded<InvoiceRow>[] | null; error: unknown }>,
    )

  const [p, inv, prevPaymentRows, prevInvoiceRows] = await Promise.all([
    paymentsIn(from, to),
    invoicesIn(from, to, true),
    paymentsIn(prevFrom, prevTo),
    needsAppointments ? invoicesIn(prevFrom, prevTo, false) : Promise.resolve([] as Embedded<InvoiceRow>[]),
  ])
  if (isStale()) return

  const appointmentById = new Map<string, AppointmentRow>()
  const patientById = new Map<string, PatientRow>()
  for (const row of [...p, ...prevPaymentRows, ...inv, ...prevInvoiceRows]) {
    if (row.patients) patientById.set(row.patients.id, row.patients)
    if (row.appointments) appointmentById.set(row.appointments.id, row.appointments)
  }
  const strip = <T extends object>(row: Embedded<T>): T => {
    const { patients: _p, appointments: _a, payments: _pay, ...rest } = row
    return rest as T
  }

  // Credit and write-off rows are not takings -- see utils/paymentReceipts.
  const notVoid = (row: PaymentRow) => row.invoices?.status !== 'void'
  payments.value = p.filter((row) => notVoid(row) && isReceipt(row.method)).map(strip)
  invoices.value = inv.map(strip)
  appointments.value = [...appointmentById.values()]
  patients.value = [...patientById.values()]
  prevPayments.value = prevPaymentRows.filter((row) => notVoid(row) && isReceipt(row.method)).map(strip)
  prevInvoices.value = prevInvoiceRows.map(strip)
  // Every payment against this period's invoices, whenever it was taken.
  invoicePayments.value = inv.flatMap((i) => i.payments ?? [])
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
