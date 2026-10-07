<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { classifyPaymentForFilter, practitionerForPayment } from '~/utils/incomeAttribution'
import { isReceipt } from '~/utils/paymentReceipts'
import { Line, Bar } from 'vue-chartjs'
import { computePresetRange, monthKeysInRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

interface PaymentRow { amount_cents: number; method: string; paid_at: string; invoice_id: string | null; patient_id: string | null; invoices?: { status: string } | null }
interface InvoiceRow { id: string; total_cents: number; status: string; appointment_id: string | null; patient_id: string | null }
interface LineItemRow { invoice_id: string; price_cents: number; quantity: number; service_id: string | null; package_purchase_id: string | null }
interface ServiceRow { id: string; name: string }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
interface PatientRow { id: string; default_practitioner_id: string | null; clinic_id: string | null }
interface TeamMemberRow { id: string; full_name: string }

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
// reports_own_only: pinned to the viewer, with the picker hidden (useOwnScope).
const { reportsPractitionerId } = useOwnScope()
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
// The money (with everything read off it) arrives in one go; the names that
// label it -- team, services, bonos, visit types -- separately.
const baseLoading = ref(true)
const namesLoading = ref(true)
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
// These used to be separate round-trips chained after the first two, each
// passing a long list of ids back in the URL -- line items by invoice id,
// appointments by id, patients by id, payments by invoice id, bonos by id,
// several chunked requests apiece. On the live clinic that was 23 requests and
// 9.7 s before the page could finish. Embedded, the database resolves the
// same foreign keys in the same query, under the same row-level security.
//
// What each panel reads is unchanged, and so is its scope: appointments only
// through the period's own invoices (a payment settling an older invoice is
// attributed by its patient, as it always was), patients only through the
// period's payments, line items only for invoices those payments settle.
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
  const { from, to } = rangeBounds(range.value)

  const [p, inv] = await Promise.all([
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
  ])
  if (mine !== run) return
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
  const [sv, tm, pkg, apptTypes] = await Promise.all([
    supabase.from('services_products').select('id, name').then((r) => r.data ?? []),
    supabase.from('team_members').select('id, full_name').then((r) => r.data ?? []),
    supabase.from('packages').select('id, name').then((r) => r.data ?? []),
    supabase.from('appointment_types').select('id, name').then((r) => r.data ?? []),
  ])
  services.value = sv
  teamMembers.value = tm
  packages.value = pkg
  appointmentTypes.value = apptTypes
  namesLoading.value = false
}

onMounted(() => {
  load()
  loadNames()
  loadFilterOptions()
  ensurePaymentMethodsLoaded()
})
watch(range, load)
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
 * It used to be totalCharged - totalPaid, which is not outstanding anything:
 * the two count different populations, since a payment in this window often
 * settles an earlier invoice and a bono or money on account is collected
 * against no invoice at all. That made it routinely NEGATIVE for this clinic
 * -- the dashboard's copy of the same arithmetic read "Outstanding -1054.00"
 * beside 2,320 collected against 1,266 invoiced.
 *
 * Measured per invoice against its own payments instead, so it answers "of
 * what we billed in this window, how much has not come in" and cannot go
 * below zero.
 *
 * A settled invoice is skipped outright rather than measured, because "has a
 * payment row pointing at it" is not what settled means here and never was.
 * Two whole populations of invoice are paid and always will have none:
 * everything imported from PracticeHub, where the ledger importer carried the
 * invoice across while the money came over as unallocated payments; and every
 * bono session's recibo, which is settled by the bono rather than by a
 * payment -- that is the point of the model. Measuring those found 7,509 EUR
 * of debt in one September, against 272 EUR that was actually owed, while
 * /billing -- which has always filtered on status -- showed 850 EUR for all
 * of history. Two pages, the same question, an order of magnitude apart.
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
  // The label the clinic chose, not the stored key: this chart used to read
  // "card, cash, other" whatever a clinic had named them, and a clinic with
  // 'transfer' and 'bizum' would have read those raw too.
  labels: byMethod.value.map((m) => labelForMethod(m.method)),
  datasets: [{ label: t('Revenue (€)', 'Ingresos (€)'), data: byMethod.value.map((m) => m.cents / 100), backgroundColor: '#4f46e5' }],
}))
const barChartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))

// The same chain the filter above applies, via practitionerForPayment --
// appointment first, then the patient's own practitioner. This used to stop
// at the appointment, so money with no visit behind it (a bono, money on
// account, a quick invoice) all landed in "Sin asignar": 13,164 EUR of
// September 2026's 16,711, while filtering to a practitioner counted those
// same euros. The two read the same payments and must not disagree about
// whose they are.
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
 * Only a minority of lines carry a service_id, and that is by design rather
 * than neglect: a bono session is not a catalogue service, and the base visit
 * line must have no service_id because AppointmentBillingTab uses exactly that
 * to tell "the visit the bono covers" from "extras the patient still owes".
 * So reading service_id alone reported 235 EUR by name and swept 4,824 into
 * one row called "Sin servicio vinculado", which is most of the clinic's
 * income and tells nobody anything.
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
 * What is left over is genuinely unidentifiable, and saying so about 940 EUR
 * is a report; saying it about 4,824 is a shrug.
 */
function lineLabel(li: LineItemRow): string {
  if (li.service_id) return serviceById.value.get(li.service_id) ?? t('Unknown service', 'Servicio desconocido')

  if (li.package_purchase_id) {
    const purchase = purchaseById.value.get(li.package_purchase_id)
    if (purchase) {
      // The template's name, falling back to the purchase's own copy for the
      // few bonos that still have no template (a retired Bono 20, a shared
      // one). Never the line's description, which is that same copy again.
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

// What "Download PDF" reads: the sections below marked data-pdf-block,
// and the figure tiles (components/reports/Stat.vue).
const pdfRoot = ref<HTMLElement | null>(null)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Income & Payments', 'Ingresos y pagos')" :meta="t('Revenue over time, by method, practitioner, and service', 'Ingresos a lo largo del tiempo, por método, profesional y servicio')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <ReportsPdfButton :target="pdfRoot" :title="t('Income & Payments', 'Ingresos y pagos')" :range="range" :practitioner-id="practitionerFilter || null" :clinic-id="clinicFilter || null" />
      </div>
    </PageHeader>

    <div ref="pdfRoot" class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" :locked-to="reportsPractitionerId" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ReportsStat :label="t('Total charged', 'Total facturado')" :loading="totalsLoading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(totalCharged) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Total paid', 'Total pagado')" :loading="totalsLoading">
          <p data-test="income-total-paid" class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(totalPaid) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Outstanding', 'Pendiente')" :loading="totalsLoading">
          <p data-test="income-outstanding" class="mt-1.5 font-mono text-[23px] font-semibold" :class="outstanding > 0 ? 'text-warning-text' : 'text-ink-900'">{{ eur(outstanding) }}</p>
        </ReportsStat>
      </div>

      <template v-if="!totalsLoading">
        <!-- Said out loud rather than silently dropped. A filtered total that
        does not reconcile with the clinic's takings is worse than one that
        names the gap: almost all of this is PracticeHub money imported
        unallocated, which PracticeHub never attributed to anyone either. -->
        <p v-if="unattributedCents > 0" class="mt-2 text-[12px] text-ink-muted2">
          {{ t('Plus', 'Más') }} <span class="font-medium text-ink-700">{{ eur(unattributedCents) }}</span>
          {{ t('in this period that no filter can attribute — money with no visit and no practitioner on the patient.', 'en este periodo que ningún filtro puede atribuir: dinero sin visita y sin profesional en el paciente.') }}
        </p>

        <!-- Money handled, not money taken. Spending credit records a payment
        of method 'credit', and for a while this page added it to the takings
        beside the cash or card the patient had originally paid it in with --
        so the same euros counted twice and "credit" appeared as a payment
        method of its own. -->
        <p v-if="creditAppliedCents > 0" class="mt-2 text-[12px] text-ink-muted2">
          {{ t('A further', 'Además') }} <span class="font-medium text-ink-700">{{ eur(creditAppliedCents) }}</span>
          {{ t('was settled from credit on account — already counted as income on the day it was paid in, so it is not in the totals above.', 'se liquidó con crédito en cuenta: ya se contó como ingreso el día en que se pagó, por lo que no está en los totales de arriba.') }}
        </p>
      </template>

      <div v-if="!totalsLoading && filteredPayments.length === 0" class="mt-4 rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13px] text-ink-faint2" data-pdf-block="image">
        {{ t('No payments recorded yet in this range — charts will fill in as receipts get paid.', 'Todavía no hay pagos registrados en este periodo — los gráficos se completarán a medida que se paguen recibos.') }}
      </div>

      <template v-else>
        <ReportsModule class="mt-4" :title="t('Revenue by month', 'Ingresos por mes')" :loading="totalsLoading">
          <div class="mt-3 h-64"><Line :data="revenueChartData" :options="lineChartOptions" /></div>
        </ReportsModule>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReportsModule :title="t('By payment method', 'Por método de pago')" :loading="totalsLoading" chart-height="h-56">
            <div class="mt-3 h-56"><Bar :data="methodChartData" :options="barChartOptions" /></div>
          </ReportsModule>
          <ReportsModule :title="t('By practitioner', 'Por profesional')" :loading="byPractitionerLoading" skeleton="list">
            <ul class="mt-2 space-y-1.5 text-[13px]">
              <li v-for="row in byPractitioner" :key="row.label" class="flex items-center justify-between">
                <span class="text-ink-600">{{ row.label }}</span>
                <span class="font-mono font-medium text-ink-900">{{ eur(row.cents) }}</span>
              </li>
            </ul>
          </ReportsModule>
        </div>

        <ReportsModule
          class="mt-4"
          :title="t('By service', 'Por servicio')"
          :description="byServiceHint"
          :loading="byServiceLoading"
          skeleton="list"
        >
          <ul class="mt-2 space-y-1.5 text-[13px]">
            <li v-for="row in byService" :key="row.label" class="flex items-center justify-between">
              <span class="text-ink-600">{{ row.label }}</span>
              <span class="font-mono font-medium text-ink-900">{{ eur(row.cents) }}</span>
            </li>
          </ul>
        </ReportsModule>
      </template>
    </div>
  </div>
</template>
