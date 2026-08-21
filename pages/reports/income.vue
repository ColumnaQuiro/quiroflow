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

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)

  const [p, inv, li, sv, appt, tm] = await Promise.all([
    fetchAllRows<PaymentRow>((f, t) =>
      supabase.from('payments').select('amount_cents, method, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()).range(f, t),
    ),
    fetchAllRows<InvoiceRow>((f, t) =>
      supabase.from('invoices').select('id, total_cents, status, appointment_id').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).range(f, t),
    ),
    fetchAllRows<LineItemRow>((f, t) => supabase.from('invoice_line_items').select('invoice_id, price_cents, quantity, service_id').range(f, t)),
    supabase.from('services_products').select('id, name').then((r) => r.data ?? []),
    fetchAllRows<AppointmentRow>((f, t) => supabase.from('appointments').select('id, practitioner_id, clinic_id').range(f, t)),
    supabase.from('team_members').select('id, full_name').then((r) => r.data ?? []),
  ])
  payments.value = p
  invoices.value = inv
  lineItems.value = li
  services.value = sv
  appointments.value = appt
  teamMembers.value = tm
  loading.value = false
}
onMounted(() => {
  load()
  loadFilterOptions()
})
watch(range, load)

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
  datasets: [{ label: 'Revenue (€)', data: revenueByMonth.value, borderColor: '#4f46e5', backgroundColor: '#4f46e5', tension: 0.3 }],
}))
const lineChartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

const byMethod = computed(() => {
  const totals = new Map<string, number>()
  for (const p of filteredPayments.value) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount_cents)
  return [...totals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)
})
const methodChartData = computed(() => ({
  labels: byMethod.value.map((m) => m.method),
  datasets: [{ label: 'Revenue (€)', data: byMethod.value.map((m) => m.cents / 100), backgroundColor: '#4f46e5' }],
}))
const barChartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))

const byPractitioner = computed(() => {
  const totals = new Map<string, number>()
  for (const p of filteredPayments.value) {
    const invoice = invoiceById.value.get(p.invoice_id)
    const appt = invoice?.appointment_id ? appointmentById.value.get(invoice.appointment_id) : undefined
    const practitionerId = appt?.practitioner_id ?? null
    const label = practitionerId ? (memberById.value.get(practitionerId) ?? 'Unknown') : 'Unassigned'
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
    const label = li.service_id ? (serviceById.value.get(li.service_id) ?? 'Unknown service') : 'No service linked'
    totals.set(label, (totals.get(label) ?? 0) + li.price_cents * li.quantity)
  }
  return [...totals.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents)
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Income & Payments" meta="Revenue over time, by method, practitioner, and service">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; Reports</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div v-if="loading" class="mt-6 text-[13px] text-ink-faint2">Loading…</div>

      <template v-else>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">Total charged</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(totalCharged) }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">Total paid</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(totalPaid) }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">Outstanding</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold" :class="outstanding > 0 ? 'text-warning-text' : 'text-ink-900'">{{ eur(outstanding) }}</p>
          </div>
        </div>

        <div v-if="filteredPayments.length === 0" class="mt-4 rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13px] text-ink-faint2">
          No payments recorded yet in this range — charts will fill in as invoices get paid.
        </div>

        <template v-else>
          <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 class="text-[13.5px] font-semibold text-ink-800">Revenue by month</h3>
            <div class="mt-3 h-64"><Line :data="revenueChartData" :options="lineChartOptions" /></div>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <h3 class="text-[13.5px] font-semibold text-ink-800">By payment method</h3>
              <div class="mt-3 h-56"><Bar :data="methodChartData" :options="barChartOptions" /></div>
            </div>
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <h3 class="text-[13.5px] font-semibold text-ink-800">By practitioner</h3>
              <ul class="mt-2 space-y-1.5 text-[13px]">
                <li v-for="row in byPractitioner" :key="row.label" class="flex items-center justify-between">
                  <span class="text-ink-600">{{ row.label }}</span>
                  <span class="font-mono font-medium text-ink-900">{{ eur(row.cents) }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 class="text-[13.5px] font-semibold text-ink-800">By service</h3>
            <p class="text-[12px] text-ink-faint2">e.g. "Primera Visita €600, Informe €6,000" — set up under Billing &rarr; Services.</p>
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
