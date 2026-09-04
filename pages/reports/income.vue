<script setup lang="ts">
import { Line, Bar } from 'vue-chartjs'
import { computePresetRange, monthKeysInRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

interface PaymentRow { amount_cents: number; method: string; paid_at: string; invoice_id: string }
interface InvoiceRow { id: string; total_cents: number; status: string; appointment_id: string | null }
interface LineItemRow { invoice_id: string; price_cents: number; quantity: number; service_id: string | null }
interface ServiceRow { id: string; name: string }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
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
const lineItems = ref<LineItemRow[]>([])
const services = ref<ServiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
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
        .select('invoice_id, price_cents, quantity, service_id')
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
      supabase.from('payments').select('amount_cents, method, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()).range(f, t),
    ),
    fetchAllRows<InvoiceRow>((f, t) =>
      supabase.from('invoices').select('id, total_cents, status, appointment_id').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).range(f, t),
    ),
    supabase.from('services_products').select('id, name').then((r) => r.data ?? []),
    supabase.from('team_members').select('id, full_name').then((r) => r.data ?? []),
  ])
  payments.value = p
  invoices.value = inv
  services.value = sv
  teamMembers.value = tm
  lineItems.value = await fetchLineItemsFor([...new Set(p.map((row) => row.invoice_id))])

  // Appointments are only consulted to resolve a practitioner/clinic filter
  // (see apptMatchesFilter) -- with no filter set, which is how the page
  // first renders, the whole table was fetched and never read.
  if (practitionerFilter.value || clinicFilter.value) await loadAppointments()
  loading.value = false
}

const appointmentsLoaded = ref(false)
async function loadAppointments() {
  if (appointmentsLoaded.value) return
  appointments.value = await fetchAllRows<AppointmentRow>((f, t) => supabase.from('appointments').select('id, practitioner_id, clinic_id').range(f, t))
  appointmentsLoaded.value = true
}

onMounted(() => {
  load()
  loadFilterOptions()
})
watch(range, load)
// Filtering is client-side against appointmentById, so the map has to exist
// before the filtered totals mean anything -- hold the loading state until
// it does rather than flashing an empty report.
watch([practitionerFilter, clinicFilter], async () => {
  if (appointmentsLoaded.value || (!practitionerFilter.value && !clinicFilter.value)) return
  loading.value = true
  await loadAppointments()
  loading.value = false
})

const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))
const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))

// practitioner/clinic filters key off the linked appointment, since neither
// payments nor invoices carry those columns directly.
function apptMatchesFilter(appointmentId: string | null): boolean {
  if (!practitionerFilter.value && !clinicFilter.value) return true
  const appt = appointmentId ? appointmentById.value.get(appointmentId) : undefined
  if (!appt) return false
  if (practitionerFilter.value && appt.practitioner_id !== practitionerFilter.value) return false
  if (clinicFilter.value && appt.clinic_id !== clinicFilter.value) return false
  return true
}
const filteredPayments = computed(() => payments.value.filter((p) => apptMatchesFilter(invoiceById.value.get(p.invoice_id)?.appointment_id ?? null)))
const filteredInvoices = computed(() => invoices.value.filter((i) => apptMatchesFilter(i.appointment_id)))

const totalPaid = computed(() => filteredPayments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const totalCharged = computed(() => filteredInvoices.value.reduce((sum, i) => sum + i.total_cents, 0))
const outstanding = computed(() => totalCharged.value - totalPaid.value)

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

const byMethod = computed(() => {
  const totals = new Map<string, number>()
  for (const p of filteredPayments.value) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount_cents)
  return [...totals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)
})
const methodChartData = computed(() => ({
  labels: byMethod.value.map((m) => m.method),
  datasets: [{ label: t('Revenue (€)', 'Ingresos (€)'), data: byMethod.value.map((m) => m.cents / 100), backgroundColor: '#4f46e5' }],
}))
const barChartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))

const byPractitioner = computed(() => {
  const totals = new Map<string, number>()
  for (const p of filteredPayments.value) {
    const invoice = invoiceById.value.get(p.invoice_id)
    const appt = invoice?.appointment_id ? appointmentById.value.get(invoice.appointment_id) : undefined
    const practitionerId = appt?.practitioner_id ?? null
    const label = practitionerId ? (memberById.value.get(practitionerId) ?? t('Unknown', 'Desconocido')) : t('Unassigned', 'Sin asignar')
    totals.set(label, (totals.get(label) ?? 0) + p.amount_cents)
  }
  return [...totals.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents)
})

const serviceById = computed(() => new Map(services.value.map((s) => [s.id, s.name])))
const byService = computed(() => {
  const paidInvoiceIds = new Set(filteredPayments.value.map((p) => p.invoice_id))
  const totals = new Map<string, number>()
  for (const li of lineItems.value) {
    if (!paidInvoiceIds.has(li.invoice_id)) continue
    const label = li.service_id ? (serviceById.value.get(li.service_id) ?? t('Unknown service', 'Servicio desconocido')) : t('No service linked', 'Sin servicio vinculado')
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
            <p class="mt-1.5 font-mono text-[23px] font-semibold" :class="outstanding > 0 ? 'text-warning-text' : 'text-ink-900'">{{ eur(outstanding) }}</p>
          </div>
        </div>

        <div v-if="filteredPayments.length === 0" class="mt-4 rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13px] text-ink-faint2">
          {{ t('No payments recorded yet in this range — charts will fill in as invoices get paid.', 'Todavía no hay pagos registrados en este periodo — los gráficos se completarán a medida que se paguen facturas.') }}
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
