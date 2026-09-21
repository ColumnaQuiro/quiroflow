<script setup lang="ts">
import { classifyPaymentForFilter } from '~/utils/incomeAttribution'
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
const practitionerFilter = ref('')
const clinicFilter = ref('')
const loading = ref(true)
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
  return `€${(cents / 100).toFixed(2)}`
}

// Only `byService` reads line items, and only for invoices the in-range
// payments point at -- fetching the whole table (every line item ever) to
// then throw away all but a month's worth was the single biggest transfer
// on this page. Payments can settle against an invoice raised outside the
// range, so this scopes by the payments' invoice ids rather than by
// invoice date. Postgrest puts `in` lists in the URL, hence the chunking.
async function fetchLineItemsFor(invoiceIds: string[]): Promise<LineItemRow[]> {
  if (invoiceIds.length === 0) return []
  const CHUNK = 300
  const chunks: string[][] = []
  for (let i = 0; i < invoiceIds.length; i += CHUNK) chunks.push(invoiceIds.slice(i, i + CHUNK))
  const results = await Promise.all(
    chunks.map((ids) =>
      supabase
        .from('invoice_line_items')
        .select('invoice_id, price_cents, quantity, service_id, package_purchase_id')
        .in('invoice_id', ids)
        .then((r) => (r.data ?? []) as LineItemRow[]),
    ),
  )
  return results.flat()
}

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)

  const [p, inv, sv, tm] = await Promise.all([
    fetchAllRows<PaymentRow>((f, t) =>
      supabase
        .from('payments')
        .select('amount_cents, method, paid_at, invoice_id, patient_id, invoices(status)')
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
    supabase.from('services_products').select('id, name').then((r) => r.data ?? []),
    supabase.from('team_members').select('id, full_name').then((r) => r.data ?? []),
  ])
  // The void rule moved out of the query when the join went from inner to
  // left: a payment with no invoice has nothing to void and must survive it.
  const notVoid = (row: PaymentRow) => row.invoices?.status !== 'void'
  payments.value = p.filter(notVoid)
  invoices.value = inv
  services.value = sv
  teamMembers.value = tm
  lineItems.value = await fetchLineItemsFor([...new Set(payments.value.map((row) => row.invoice_id).filter((id): id is string => !!id))])

  // Every payment against this period's invoices, whenever it was taken. An
  // invoice raised on the 30th is usually settled in the next window, and
  // outstanding has to see that money or it reports a debt already paid.
  // Chunked: PostgREST puts an .in() list in the URL, and a busy month's
  // invoices make one long enough to be refused.
  const invoiceIds = inv.map((i) => i.id)
  const allocations: { invoice_id: string | null; amount_cents: number }[] = []
  for (let start = 0; start < invoiceIds.length; start += 200) {
    const chunk = invoiceIds.slice(start, start + 200)
    const rows = await fetchAllRows<{ invoice_id: string | null; amount_cents: number }>((f, t) =>
      supabase.from('payments').select('invoice_id, amount_cents').in('invoice_id', chunk).range(f, t),
    )
    allocations.push(...rows)
  }
  invoicePayments.value = allocations

  // What each line was for. Fetched by id rather than wholesale: the
  // appointments table is thousands of rows and this only needs the ones
  // behind invoices in range, which is why the practitioner filter loads it
  // separately and only when set.
  const purchaseIds = [...new Set(lineItems.value.map((li) => li.package_purchase_id).filter((id): id is string => !!id))]
  const appointmentIds = [...new Set(inv.map((i) => i.appointment_id).filter((id): id is string => !!id))]
  const [pur, pkg, apptTypes, appts] = await Promise.all([
    purchaseIds.length
      ? fetchAllRows<{ id: string; package_id: string | null; package_name: string }>((f, t) =>
          supabase.from('package_purchases').select('id, package_id, package_name').in('id', purchaseIds).range(f, t),
        )
      : Promise.resolve([] as { id: string; package_id: string | null; package_name: string }[]),
    supabase.from('packages').select('id, name').then((r) => r.data ?? []),
    supabase.from('appointment_types').select('id, name').then((r) => r.data ?? []),
    appointmentIds.length
      ? fetchAllRows<{ id: string; appointment_type_id: string | null }>((f, t) =>
          supabase.from('appointments').select('id, appointment_type_id').in('id', appointmentIds).range(f, t),
        )
      : Promise.resolve([] as { id: string; appointment_type_id: string | null }[]),
  ])
  purchases.value = pur
  packages.value = pkg
  appointmentTypes.value = apptTypes
  const typeByAppointment = new Map(appts.map((a) => [a.id, a.appointment_type_id]))
  invoiceAppointmentTypes.value = inv
    .filter((i) => i.appointment_id)
    .map((i) => ({ invoice_id: i.id, appointment_type_id: typeByAppointment.get(i.appointment_id!) ?? null }))

  // Appointments and patients are only consulted to resolve a
  // practitioner/clinic filter -- with no filter set, which is how the page
  // first renders, both tables were fetched and never read.
  if (practitionerFilter.value || clinicFilter.value) await loadAttribution()
  loading.value = false
}

const appointmentsLoaded = ref(false)
async function loadAttribution() {
  if (appointmentsLoaded.value) return
  const [appts, pats] = await Promise.all([
    fetchAllRows<AppointmentRow>((f, t) => supabase.from('appointments').select('id, practitioner_id, clinic_id').range(f, t)),
    // The fallback for money with no appointment behind it.
    fetchAllRows<PatientRow>((f, t) => supabase.from('patients').select('id, default_practitioner_id, clinic_id').range(f, t)),
  ])
  appointments.value = appts
  patients.value = pats
  appointmentsLoaded.value = true
}

onMounted(() => {
  load()
  loadFilterOptions()
  ensurePaymentMethodsLoaded()
})
watch(range, load)
// Filtering is client-side against appointmentById, so the map has to exist
// before the filtered totals mean anything -- hold the loading state until
// it does rather than flashing an empty report.
watch([practitionerFilter, clinicFilter], async () => {
  if (appointmentsLoaded.value || (!practitionerFilter.value && !clinicFilter.value)) return
  loading.value = true
  await loadAttribution()
  loading.value = false
})

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

// Money no filter can place -- almost all of it PracticeHub payments imported
// unallocated, which PracticeHub never attributed either. Reported rather
// than dropped, so a filtered total still reconciles with the takings.
const unattributedCents = computed(() =>
  payments.value
    .filter((p) => classify(appointmentIdOf(p.invoice_id), p.patient_id) === 'unattributable')
    .reduce((sum, p) => sum + p.amount_cents, 0),
)

const totalPaid = computed(() => filteredPayments.value.reduce((sum, p) => sum + p.amount_cents, 0))
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
  for (const p of filteredPayments.value) {
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
  for (const p of filteredPayments.value) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount_cents)
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

const byPractitioner = computed(() => {
  const totals = new Map<string, number>()
  for (const p of filteredPayments.value) {
    const invoice = p.invoice_id ? invoiceById.value.get(p.invoice_id) : undefined
    const appt = invoice?.appointment_id ? appointmentById.value.get(invoice.appointment_id) : undefined
    const practitionerId = appt?.practitioner_id ?? null
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
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Income & Payments', 'Ingresos y pagos')" :meta="t('Revenue over time, by method, practitioner, and service', 'Ingresos a lo largo del tiempo, por método, profesional y servicio')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div v-if="loading" class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div v-for="i in 3" :key="i" class="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
          <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
          <UiSkeleton class="h-[23px] w-20 rounded-ctlSm" />
        </div>
      </div>

      <template v-else>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Total charged', 'Total facturado') }}</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(totalCharged) }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Total paid', 'Total pagado') }}</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(totalPaid) }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Outstanding', 'Pendiente') }}</p>
            <p data-test="income-outstanding" class="mt-1.5 font-mono text-[23px] font-semibold" :class="outstanding > 0 ? 'text-warning-text' : 'text-ink-900'">{{ eur(outstanding) }}</p>
          </div>
        </div>

        <!-- Said out loud rather than silently dropped. A filtered total that
        does not reconcile with the clinic's takings is worse than one that
        names the gap: almost all of this is PracticeHub money imported
        unallocated, which PracticeHub never attributed to anyone either. -->
        <p v-if="unattributedCents > 0" class="mt-2 text-[12px] text-ink-muted2">
          {{ t('Plus', 'Más') }} <span class="font-medium text-ink-700">{{ eur(unattributedCents) }}</span>
          {{ t('in this period that no filter can attribute — money with no visit and no practitioner on the patient.', 'en este periodo que ningún filtro puede atribuir: dinero sin visita y sin profesional en el paciente.') }}
        </p>

        <div v-if="filteredPayments.length === 0" class="mt-4 rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13px] text-ink-faint2">
          {{ t('No payments recorded yet in this range — charts will fill in as receipts get paid.', 'Todavía no hay pagos registrados en este periodo — los gráficos se completarán a medida que se paguen recibos.') }}
        </div>

        <template v-else>
          <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('Revenue by month', 'Ingresos por mes') }}</h3>
            <div class="mt-3 h-64"><Line :data="revenueChartData" :options="lineChartOptions" /></div>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('By payment method', 'Por método de pago') }}</h3>
              <div class="mt-3 h-56"><Bar :data="methodChartData" :options="barChartOptions" /></div>
            </div>
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('By practitioner', 'Por profesional') }}</h3>
              <ul class="mt-2 space-y-1.5 text-[13px]">
                <li v-for="row in byPractitioner" :key="row.label" class="flex items-center justify-between">
                  <span class="text-ink-600">{{ row.label }}</span>
                  <span class="font-mono font-medium text-ink-900">{{ eur(row.cents) }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('By service', 'Por servicio') }}</h3>
            <p class="text-[12px] text-ink-faint2">{{ t('e.g. "Primera Visita €600, Informe €6,000" — set up under Billing → Services.', 'p. ej. "Primera Visita 600 €, Informe 6.000 €" — configúralo en Facturación → Servicios.') }}</p>
            <ul class="mt-2 space-y-1.5 text-[13px]">
              <li v-for="row in byService" :key="row.label" class="flex items-center justify-between">
                <span class="text-ink-600">{{ row.label }}</span>
                <span class="font-mono font-medium text-ink-900">{{ eur(row.cents) }}</span>
              </li>
            </ul>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
