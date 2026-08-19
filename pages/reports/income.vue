<script setup lang="ts">
import { Line, Bar } from 'vue-chartjs'
import { computePresetRange, monthKeysInRange, rangeBounds } from '~/composables/useDateRangePresets'

interface PaymentRow { amount_cents: number; method: string; paid_at: string; invoice_id: string }
interface InvoiceRow { id: string; total_cents: number; status: string; appointment_id: string | null }
interface LineItemRow { invoice_id: string; price_cents: number; quantity: number; service_id: string | null }
interface ServiceRow { id: string; name: string }
interface AppointmentRow { id: string; practitioner_id: string | null }
interface TeamMemberRow { id: string; full_name: string }

const supabase = useSupabaseClient()

const range = ref(computePresetRange({ months: 6 }))
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

  const [{ data: p }, { data: inv }, { data: li }, { data: sv }, { data: appt }, { data: tm }] = await Promise.all([
    supabase.from('payments').select('amount_cents, method, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()),
    supabase.from('invoices').select('id, total_cents, status, appointment_id'),
    supabase.from('invoice_line_items').select('invoice_id, price_cents, quantity, service_id'),
    supabase.from('services_products').select('id, name'),
    supabase.from('appointments').select('id, practitioner_id'),
    supabase.from('team_members').select('id, full_name'),
  ])
  payments.value = p ?? []
  invoices.value = inv ?? []
  lineItems.value = li ?? []
  services.value = sv ?? []
  appointments.value = appt ?? []
  teamMembers.value = tm ?? []
  loading.value = false
}
onMounted(load)
watch(range, load)

const totalPaid = computed(() => payments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const totalCharged = computed(() => invoices.value.reduce((sum, i) => sum + i.total_cents, 0))
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
  for (const p of payments.value) {
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
  for (const p of payments.value) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount_cents)
  return [...totals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)
})
const methodChartData = computed(() => ({
  labels: byMethod.value.map((m) => m.method),
  datasets: [{ label: 'Revenue (€)', data: byMethod.value.map((m) => m.cents / 100), backgroundColor: '#4f46e5' }],
}))
const barChartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))
const memberById = computed(() => new Map(teamMembers.value.map((m) => [m.id, m.full_name])))

const byPractitioner = computed(() => {
  const totals = new Map<string, number>()
  for (const p of payments.value) {
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
  const paidInvoiceIds = new Set(payments.value.map((p) => p.invoice_id))
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
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Income &amp; Payments</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Revenue over time, by payment method, by practitioner, and by service.</p>

    <div class="mt-4">
      <ReportsDateRangeSelect v-model="range" />
    </div>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>

    <template v-else>
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Total charged</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ eur(totalCharged) }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Total paid</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ eur(totalPaid) }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Outstanding</p>
          <p class="mt-1 text-2xl font-semibold" :class="outstanding > 0 ? 'text-amber-600' : 'text-gray-900'">{{ eur(outstanding) }}</p>
        </div>
      </div>

      <div v-if="payments.length === 0" class="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">
        No payments recorded yet in this range — charts will fill in as invoices get paid.
      </div>

      <template v-else>
        <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 class="text-sm font-semibold text-gray-900">Revenue by month</h3>
          <div class="mt-3 h-64"><Line :data="revenueChartData" :options="lineChartOptions" /></div>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-gray-200 bg-white p-4">
            <h3 class="text-sm font-semibold text-gray-900">By payment method</h3>
            <div class="mt-3 h-56"><Bar :data="methodChartData" :options="barChartOptions" /></div>
          </div>
          <div class="rounded-lg border border-gray-200 bg-white p-4">
            <h3 class="text-sm font-semibold text-gray-900">By practitioner</h3>
            <ul class="mt-2 space-y-1.5 text-sm">
              <li v-for="row in byPractitioner" :key="row.label" class="flex items-center justify-between">
                <span class="text-gray-700">{{ row.label }}</span>
                <span class="font-medium text-gray-900">{{ eur(row.cents) }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 class="text-sm font-semibold text-gray-900">By service</h3>
          <p class="text-xs text-gray-400">e.g. "Primera Visita €600, Informe €6,000" — set up under Billing &rarr; Services.</p>
          <ul class="mt-2 space-y-1.5 text-sm">
            <li v-for="row in byService" :key="row.label" class="flex items-center justify-between">
              <span class="text-gray-700">{{ row.label }}</span>
              <span class="font-medium text-gray-900">{{ eur(row.cents) }}</span>
            </li>
          </ul>
        </div>
      </template>
    </template>
  </div>
</template>
