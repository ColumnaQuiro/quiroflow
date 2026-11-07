<script setup lang="ts">
// Ingresos y pagos, on the phone: the web's pages/reports/income.vue with the
// same two embedded reads, the same void and receipt rules and the same
// attribution chain (utils/incomeAttribution, utils/paymentReceipts), so a
// figure here is the figure there. Reshaped for a phone: the three headline
// tiles sit two to a row, the charts keep their place at phone height, and
// the practitioner and service breakdowns are ReportRow lists (the service
// list shows its first 50 lines and a "Ver más"); the payment-method chart
// also lists its amounts underneath, since a bar's value is hard to read off
// a 375 px chart. Left out: the PDF button (no PDF on the app yet). The
// breakdown hint still names Billing -> Services, which is where it is set
// up, on the web -- the app has no settings to link to.
import { formatEur } from '../../../utils/billing'
import { classifyPaymentForFilter, practitionerForPayment } from '../../../utils/incomeAttribution'
import { isReceipt } from '../../../utils/paymentReceipts'
import { Line, Bar } from 'vue-chartjs'
import '../../../utils/chartSetup'
import { computePresetRange, monthKeysInRange, rangeBounds } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'

definePageMeta({ layout: 'practitioner' })

interface PaymentRow { amount_cents: number; method: string; paid_at: string; invoice_id: string | null; patient_id: string | null; invoices?: { status: string } | null }
interface InvoiceRow { id: string; total_cents: number; status: string; appointment_id: string | null; patient_id: string | null }
interface LineItemRow { invoice_id: string; price_cents: number; quantity: number; service_id: string | null; package_purchase_id: string | null }
interface ServiceRow { id: string; name: string }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
interface PatientRow { id: string; default_practitioner_id: string | null; clinic_id: string | null }
interface TeamMemberRow { id: string; full_name: string }

const PATH = '/reports/income'
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
// The money (with everything read off it) arrives in one go; the names that
// label it -- team, services, bonos, visit types -- separately.
const baseLoading = ref(true)
const namesLoading = ref(true)
const failed = ref(false)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const invoicePayments = ref<{ invoice_id: string | null; amount_cents: number }[]>([])
const lineItems = ref<LineItemRow[]>([])
const services = ref<ServiceRow[]>([])
// Only what naming a line needs: the bonos its lines drew from, the templates
// those bonos belong to, and the type of visit behind each invoice.
const purchases = ref<{ id: string; package_id: string | null; package_name: string }[]>([])
const packages = ref<{ id: string; name: string }[]>([])
const appointmentTypes = ref<{ id: string; name: string }[]>([])
const invoiceAppointmentTypes = ref<{ invoice_id: string; appointment_type_id: string | null }[]>([])
const appointments = ref<AppointmentRow[]>([])
const patients = ref<PatientRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])

function eur(cents: number) {
  return `${formatEur(cents)}`
}

// The period's payments and invoices, each carrying what the page reads off
// them, in two requests side by side:
//
//   payments -- the invoice each settles (its status, for the void rule, and
//               its line items with the bonos they drew from, for "By
//               service") and the patient it was taken from (whose money it
//               is when there is no visit behind it)
//   invoices -- the visit behind each (whose money it is, and what type of
//               visit it was) and every payment ever made against it
//               (outstanding), whenever it was taken
//
// Embedded, the database resolves the foreign keys in the same query, under
// the same row-level security, instead of a chain of id-list requests.
//
// What each panel reads, and its scope, is the web's: appointments only
// through the period's own invoices (a payment settling an older invoice is
// attributed by its patient), patients only through the period's payments,
// line items only for invoices those payments settle.
interface EmbeddedPaymentRow extends Omit<PaymentRow, 'invoices'> {
  invoices: { status: string; invoice_line_items: (LineItemRow & { package_purchases: { id: string; package_id: string | null; package_name: string } | null })[] } | null
  patients: PatientRow | null
}
interface EmbeddedInvoiceRow extends InvoiceRow {
  appointments: (AppointmentRow & { appointment_type_id: string | null }) | null
  payments: { invoice_id: string | null; amount_cents: number }[]
}

// A range picked while this is in flight starts another run, and only the
// latest may write.
let run = 0
async function load() {
  const mine = ++run
  baseLoading.value = true
  failed.value = false
  const { from, to } = rangeBounds(range.value)

  const result = await Promise.all([
    fetchAllRows<EmbeddedPaymentRow>(
      (f, t) =>
        supabase
          .from('payments')
          .select(
            'amount_cents, method, paid_at, invoice_id, patient_id, invoices!payments_invoice_id_fkey(status, invoice_line_items(invoice_id, price_cents, quantity, service_id, package_purchase_id, package_purchases(id, package_id, package_name))), patients!payments_patient_id_fkey(id, default_practitioner_id, clinic_id)',
          )
          .gte('paid_at', from.toISOString())
          .lte('paid_at', to.toISOString())
          .range(f, t) as unknown as PromiseLike<{ data: EmbeddedPaymentRow[] | null; error: unknown }>,
    ),
    fetchAllRows<EmbeddedInvoiceRow>(
      (f, t) =>
        supabase
          .from('invoices')
          .select('id, total_cents, status, appointment_id, patient_id, appointments!invoices_appointment_id_fkey(id, appointment_type_id, practitioner_id, clinic_id), payments!payments_invoice_id_fkey(invoice_id, amount_cents)')
          .neq('status', 'void')
          .gte('created_at', from.toISOString())
          .lte('created_at', to.toISOString())
          .range(f, t) as unknown as PromiseLike<{ data: EmbeddedInvoiceRow[] | null; error: unknown }>,
    ),
  ]).catch(() => null)
  if (mine !== run) return
  // A refused read is not "no income": say so instead of drawing zeros.
  if (!result) {
    failed.value = true
    baseLoading.value = false
    return
  }
  const [p, inv] = result
  // The void rule is applied here rather than in the query: the join is a
  // left one, and a payment with no invoice has nothing to void and must
  // survive it.
  const kept = p.filter((row) => row.invoices?.status !== 'void')
  payments.value = kept.map(({ invoices: invoice, patients: _patient, ...row }) => ({ ...row, invoices: invoice ? { status: invoice.status } : null }))
  invoices.value = inv.map(({ appointments: _appointment, payments: _payments, ...row }) => row)

  // The patients behind the payments on screen.
  const patientById = new Map<string, PatientRow>()
  for (const row of kept) if (row.patients) patientById.set(row.patients.id, row.patients)
  patients.value = [...patientById.values()]

  // The visits behind the period's invoices, and what type each was.
  const appointmentById = new Map<string, AppointmentRow & { appointment_type_id: string | null }>()
  for (const i of inv) if (i.appointments) appointmentById.set(i.appointments.id, i.appointments)
  appointments.value = [...appointmentById.values()]
  invoiceAppointmentTypes.value = inv
    .filter((i) => i.appointment_id)
    .map((i) => ({ invoice_id: i.id, appointment_type_id: appointmentById.get(i.appointment_id!)?.appointment_type_id ?? null }))

  // Every payment against the period's invoices, whenever it was taken.
  invoicePayments.value = inv.flatMap((i) => i.payments)

  // The line items of the invoices those payments settle -- once per
  // invoice, however many payments settle it -- and the bonos they drew from.
  const itemsByInvoice = new Map<string, LineItemRow[]>()
  const purchaseById = new Map<string, { id: string; package_id: string | null; package_name: string }>()
  for (const row of kept) {
    if (!row.invoice_id || !row.invoices || itemsByInvoice.has(row.invoice_id)) continue
    itemsByInvoice.set(
      row.invoice_id,
      row.invoices.invoice_line_items.map(({ package_purchases: purchase, ...item }) => {
        if (purchase) purchaseById.set(purchase.id, purchase)
        return item
      }),
    )
  }
  lineItems.value = [...itemsByInvoice.values()].flat()
  purchases.value = [...purchaseById.values()]
  baseLoading.value = false
}

// None of these depend on the range, so they are not refetched with it.
async function loadNames() {
  namesLoading.value = true
  const [sv, tm, pkg, apptTypes] = await Promise.all([
    supabase.from('services_products').select('id, name'),
    supabase.from('team_members').select('id, full_name'),
    supabase.from('packages').select('id, name'),
    supabase.from('appointment_types').select('id, name'),
  ])
  // A missing name list would relabel real money "Desconocido": fail instead.
  if (sv.error || tm.error || pkg.error || apptTypes.error) {
    failed.value = true
    return
  }
  services.value = sv.data ?? []
  teamMembers.value = tm.data ?? []
  packages.value = pkg.data ?? []
  appointmentTypes.value = apptTypes.data ?? []
  namesLoading.value = false
}

function loadAll() {
  load()
  loadNames()
  loadFilterOptions()
  ensurePaymentMethodsLoaded()
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "no income".
watch(() => !!context.value && canOpen(PATH), (ok) => { if (ok) loadAll() }, { immediate: true })
watch(range, () => { if (context.value && canOpen(PATH)) load() })
// No watcher on the filters: they are applied client-side against maps this
// load() has already built, so changing one re-computes rather than refetches.

// When each panel can draw: the totals need only the money; the breakdowns
// also need the names they are labelled with.
const totalsLoading = computed(() => baseLoading.value)
const byPractitionerLoading = computed(() => baseLoading.value || namesLoading.value)
const byServiceLoading = computed(() => byPractitionerLoading.value)

const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))
const patientById = computed(() => new Map(patients.value.map((p) => [p.id, p])))
const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const paidByInvoice = computed(() => {
  const map = new Map<string, number>()
  for (const row of invoicePayments.value) {
    if (!row.invoice_id) continue
    map.set(row.invoice_id, (map.get(row.invoice_id) ?? 0) + row.amount_cents)
  }
  return map
})

// practitioner/clinic filters key off the linked appointment, since neither
// payments nor invoices carry those columns directly.
// Where there is no appointment -- a bono, money on account, a quick invoice
// -- the patient's own practitioner answers instead. See utils/incomeAttribution.
function classify(appointmentId: string | null, patientId: string | null) {
  return classifyPaymentForFilter({
    practitionerId: practitionerFilter.value || undefined,
    clinicId: clinicFilter.value || undefined,
    appointment: appointmentId ? (appointmentById.value.get(appointmentId) ?? null) : null,
    patient: patientId ? (patientById.value.get(patientId) ?? null) : null,
  })
}
function appointmentIdOf(invoiceId: string | null): string | null {
  return (invoiceId ? invoiceById.value.get(invoiceId) : undefined)?.appointment_id ?? null
}
const filteredPayments = computed(() => payments.value.filter((p) => classify(appointmentIdOf(p.invoice_id), p.patient_id) === 'matches'))
const filteredInvoices = computed(() => invoices.value.filter((i) => classify(i.appointment_id, i.patient_id) === 'matches'))

/**
 * The money that actually came in.
 *
 * Credit and write-off rows settle an invoice without anything arriving --
 * see utils/paymentReceipts -- so every figure on this page that means
 * TAKINGS reads this instead of filteredPayments. "By service" deliberately
 * does not: a session paid out of a bono is still a session delivered, and
 * dropping it would leave the service chart describing a different month from
 * the rest of the page.
 */
const receipts = computed(() => filteredPayments.value.filter((p) => isReceipt(p.method)))

/**
 * Credit spent in this period, named rather than silently missing.
 *
 * It is not income -- it was income on the day the patient paid it in, under
 * cash or card -- but it is money the clinic handled this month, and a figure
 * that simply disappears from a report is how the double count went unnoticed
 * in the first place.
 */
const creditAppliedCents = computed(() =>
  filteredPayments.value.filter((p) => p.method === 'credit').reduce((sum, p) => sum + p.amount_cents, 0),
)

// Money no filter can place -- almost all of it PracticeHub payments imported
// unallocated, which PracticeHub never attributed either. Reported rather
// than dropped, so a filtered total still reconciles with the takings.
const unattributedCents = computed(() =>
  payments.value
    .filter((p) => isReceipt(p.method) && classify(appointmentIdOf(p.invoice_id), p.patient_id) === 'unattributable')
    .reduce((sum, p) => sum + p.amount_cents, 0),
)

const totalPaid = computed(() => receipts.value.reduce((sum, p) => sum + p.amount_cents, 0))
const totalCharged = computed(() => filteredInvoices.value.reduce((sum, i) => sum + i.total_cents, 0))
/**
 * What is still unpaid on the invoices raised in this period.
 *
 * Not totalCharged - totalPaid: the two count different populations, since a
 * payment in this window often settles an earlier invoice and a bono or
 * money on account is collected against no invoice at all, which made that
 * difference routinely NEGATIVE. Measured per invoice against its own
 * payments instead, so it answers "of what we billed in this window, how
 * much has not come in" and cannot go below zero.
 *
 * A settled invoice is skipped outright rather than measured, because "has a
 * payment row pointing at it" is not what settled means here: everything
 * imported from PracticeHub (the money came over as unallocated payments) and
 * every bono session's recibo (settled by the bono, not by a payment) is paid
 * with no payment row at all. Measuring those found an order of magnitude
 * more "debt" than /billing, which has always filtered on status.
 */
const outstanding = computed(() =>
  filteredInvoices.value
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + Math.max(0, i.total_cents - (paidByInvoice.value.get(i.id) ?? 0)), 0),
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

const revenueByMonth = computed(() => {
  const totals = new Map<string, number>(monthKeys.value.map((k) => [k, 0]))
  for (const p of receipts.value) {
    const k = monthKey(p.paid_at)
    if (totals.has(k)) totals.set(k, (totals.get(k) ?? 0) + p.amount_cents)
  }
  return monthKeys.value.map((k) => (totals.get(k) ?? 0) / 100)
})
const revenueChartData = computed(() => ({
  labels: monthKeys.value.map(monthLabel),
  datasets: [{ label: t('Revenue (€)', 'Ingresos (€)'), data: revenueByMonth.value, borderColor: '#4f46e5', backgroundColor: '#4f46e5', tension: 0.3 }],
}))
const lineChartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

const { ensureLoaded: ensurePaymentMethodsLoaded, labelFor: labelForMethod } = usePaymentMethods()

const byMethod = computed(() => {
  const totals = new Map<string, number>()
  for (const p of receipts.value) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount_cents)
  return [...totals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)
})
const methodChartData = computed(() => ({
  // The label the clinic chose, not the stored key.
  labels: byMethod.value.map((m) => labelForMethod(m.method)),
  datasets: [{ label: t('Revenue (€)', 'Ingresos (€)'), data: byMethod.value.map((m) => m.cents / 100), backgroundColor: '#4f46e5' }],
}))
const barChartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))

// The same chain the filter above applies, via practitionerForPayment --
// appointment first, then the patient's own practitioner. Stopping at the
// appointment put money with no visit behind it (a bono, money on account, a
// quick invoice) in "Sin asignar" while filtering to a practitioner counted
// those same euros. The two read the same payments and must not disagree
// about whose they are.
const byPractitioner = computed(() => {
  const totals = new Map<string, number>()
  for (const p of receipts.value) {
    const appointmentId = appointmentIdOf(p.invoice_id)
    const practitionerId = practitionerForPayment({
      appointment: appointmentId ? (appointmentById.value.get(appointmentId) ?? null) : null,
      patient: p.patient_id ? (patientById.value.get(p.patient_id) ?? null) : null,
    })
    const label = practitionerId ? (memberById.value.get(practitionerId) ?? t('Unknown', 'Desconocido')) : t('Unassigned', 'Sin asignar')
    totals.set(label, (totals.get(label) ?? 0) + p.amount_cents)
  }
  return [...totals.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents)
})

const serviceById = computed(() => new Map(services.value.map((s) => [s.id, s.name])))
const purchaseById = computed(() => new Map(purchases.value.map((p) => [p.id, p])))
const packageById = computed(() => new Map(packages.value.map((p) => [p.id, p.name])))
const appointmentTypeById = computed(() => new Map(appointmentTypes.value.map((a) => [a.id, a.name])))
const appointmentTypeIdByInvoice = computed(
  () => new Map(invoiceAppointmentTypes.value.filter((r) => r.appointment_type_id).map((r) => [r.invoice_id, r.appointment_type_id!])),
)

/**
 * What a line was for.
 *
 * Only a minority of lines carry a service_id, and that is by design: a bono
 * session is not a catalogue service, and the base visit line must have no
 * service_id because AppointmentBillingTab uses exactly that to tell "the
 * visit the bono covers" from "extras the patient still owes". So reading
 * service_id alone swept most of the clinic's income into one row called
 * "Sin servicio vinculado".
 *
 * Three sources, in order of how directly they say it:
 *
 *   1. the catalogue service, when a line has one -- a product, an added extra
 *   2. the BONO, through package_purchase_id, reported by its template so a
 *      migrated "Bono 12" and the same bono sold here as "Bono 12 sesiones"
 *      land in one row instead of two
 *   3. the APPOINTMENT TYPE behind the invoice -- Ajuste, Primera visita --
 *      which is what an ordinary visit line is for
 *
 * What is left over is genuinely unidentifiable.
 */
function lineLabel(li: LineItemRow): string {
  if (li.service_id) return serviceById.value.get(li.service_id) ?? t('Unknown service', 'Servicio desconocido')

  if (li.package_purchase_id) {
    const purchase = purchaseById.value.get(li.package_purchase_id)
    if (purchase) {
      // The template's name, falling back to the purchase's own copy for the
      // few bonos that still have no template. Never the line's description,
      // which is that same copy again.
      const templateName = purchase.package_id ? packageById.value.get(purchase.package_id) : null
      return templateName ?? purchase.package_name
    }
  }

  const appointmentTypeId = appointmentTypeIdByInvoice.value.get(li.invoice_id)
  if (appointmentTypeId) {
    const name = appointmentTypeById.value.get(appointmentTypeId)
    if (name) return name
  }

  return t('Not identified', 'Sin identificar')
}

const byServiceHint = computed(() =>
  t('e.g. "Primera Visita €600, Informe €6,000" — set up under Billing → Services.', 'p. ej. "Primera Visita 600 €, Informe 6.000 €" — configúralo en Facturación → Servicios.'),
)

const byService = computed(() => {
  const paidInvoiceIds = new Set(filteredPayments.value.map((p) => p.invoice_id))
  const totals = new Map<string, number>()
  for (const li of lineItems.value) {
    if (!paidInvoiceIds.has(li.invoice_id)) continue
    const label = lineLabel(li)
    totals.set(label, (totals.get(label) ?? 0) + li.price_cents * li.quantity)
  }
  return [...totals.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents)
})

// A clinic with a long catalogue: the first 50 lines, and more on request.
const SERVICE_PAGE = 50
const servicesShown = ref(SERVICE_PAGE)
watch(range, () => { servicesShown.value = SERVICE_PAGE })
const visibleServices = computed(() => byService.value.slice(0, servicesShown.value))

function retry() {
  failed.value = false
  load()
  loadNames()
}
</script>

<template>
  <ReportScreen :title="t('Income & Payments', 'Ingresos y pagos')" :path="PATH" :description="t('Revenue over time, by method, practitioner, and service', 'Ingresos a lo largo del tiempo, por método, profesional y servicio')">
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :locked-to="reportsPractitionerId" :practitioners="practitioners" :clinics="clinics" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="report-income-error">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 min-h-[44px] font-semibold underline" @click="retry">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <ReportsStat :label="t('Total charged', 'Total facturado')" :loading="totalsLoading">
          <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-income-total-charged">{{ eur(totalCharged) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Total paid', 'Total pagado')" :loading="totalsLoading">
          <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-income-total-paid">{{ eur(totalPaid) }}</p>
        </ReportsStat>
        <ReportsStat class="col-span-2 md:col-span-1" :label="t('Outstanding', 'Pendiente')" :loading="totalsLoading">
          <p class="font-mono text-[23px] font-semibold" :class="outstanding > 0 ? 'text-warning-text' : 'text-ink-900'" data-cy="report-income-outstanding">{{ eur(outstanding) }}</p>
        </ReportsStat>
      </div>

      <template v-if="!totalsLoading">
        <!-- Said out loud rather than silently dropped: a filtered total that
        does not reconcile with the clinic's takings is worse than one that
        names the gap. -->
        <p v-if="unattributedCents > 0" class="px-1 text-[12.5px] leading-snug text-ink-muted" data-cy="report-income-unattributed">
          {{ t('Plus', 'Más') }} <span class="font-medium text-ink-700">{{ eur(unattributedCents) }}</span>
          {{ t('in this period that no filter can attribute — money with no visit and no practitioner on the patient.', 'en este periodo que ningún filtro puede atribuir: dinero sin visita y sin profesional en el paciente.') }}
        </p>

        <!-- Money handled, not money taken: credit spent was income on the
        day it was paid in, so it is named here and kept out of the totals. -->
        <p v-if="creditAppliedCents > 0" class="px-1 text-[12.5px] leading-snug text-ink-muted" data-cy="report-income-credit-applied">
          {{ t('A further', 'Además') }} <span class="font-medium text-ink-700">{{ eur(creditAppliedCents) }}</span>
          {{ t('was settled from credit on account — already counted as income on the day it was paid in, so it is not in the totals above.', 'se liquidó con crédito en cuenta: ya se contó como ingreso el día en que se pagó, por lo que no está en los totales de arriba.') }}
        </p>
      </template>

      <div v-if="!totalsLoading && filteredPayments.length === 0" class="rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13.5px] text-ink-faint" data-cy="report-income-empty">
        {{ t('No payments recorded yet in this range — charts will fill in as receipts get paid.', 'Todavía no hay pagos registrados en este periodo — los gráficos se completarán a medida que se paguen recibos.') }}
      </div>

      <template v-else>
        <ReportsModule :title="t('Revenue by month', 'Ingresos por mes')" :loading="totalsLoading" chart-height="h-56">
          <div class="mt-3 h-56" data-cy="report-income-revenue-chart"><Line :data="revenueChartData" :options="lineChartOptions" /></div>
        </ReportsModule>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ReportsModule :title="t('By payment method', 'Por método de pago')" :loading="totalsLoading" chart-height="h-56">
            <div class="mt-3 h-56"><Bar :data="methodChartData" :options="barChartOptions" /></div>
            <ul class="mt-2" data-cy="report-income-by-method">
              <ReportRow v-for="m in byMethod" :key="m.method" :title="labelForMethod(m.method)" :value="eur(m.cents)" />
            </ul>
          </ReportsModule>
          <ReportsModule :title="t('By practitioner', 'Por profesional')" :loading="byPractitionerLoading" skeleton="list">
            <p v-if="byPractitioner.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No income in this range.', 'Sin ingresos en este periodo.') }}</p>
            <ul v-else class="mt-1" data-cy="report-income-by-practitioner">
              <ReportRow v-for="row in byPractitioner" :key="row.label" :title="row.label" :value="eur(row.cents)" />
            </ul>
          </ReportsModule>
        </div>

        <ReportsModule :title="t('By service', 'Por servicio')" :description="byServiceHint" :loading="byServiceLoading" skeleton="list" :rows="6">
          <p v-if="byService.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No invoiced lines behind these payments.', 'No hay líneas facturadas detrás de estos pagos.') }}</p>
          <template v-else>
            <ul class="mt-1" data-cy="report-income-by-service">
              <ReportRow v-for="row in visibleServices" :key="row.label" :title="row.label" :value="eur(row.cents)" />
            </ul>
            <button
              v-if="byService.length > servicesShown"
              type="button"
              class="mt-1 flex h-11 w-full items-center justify-center rounded-ctl text-[13.5px] font-semibold text-brand-text active:bg-surface-subtle"
              data-cy="report-income-by-service-more"
              @click="servicesShown += SERVICE_PAGE"
            >
              {{ t(`Show more (${byService.length - servicesShown})`, `Ver más (${byService.length - servicesShown})`) }}
            </button>
          </template>
        </ReportsModule>
      </template>
    </template>
  </ReportScreen>
</template>
