<script setup lang="ts">
import { Line } from 'vue-chartjs'
import { computePresetRange, monthKeysInRange, rangeBounds, type DateRangePreset } from '~/composables/useDateRangePresets'

interface PaymentRow { amount_cents: number; paid_at: string; invoice_id: string }
interface InvoiceRow { id: string; appointment_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null }
interface TeamMemberRow { id: string; full_name: string; color: string }

const PRESETS: DateRangePreset[] = [
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
  { label: 'Last 24 months', months: 24 },
]

const supabase = useSupabaseClient()

const range = ref(computePresetRange({ months: 12 }))
const loading = ref(true)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)

  const [{ data: p }, { data: inv }, { data: appt }, { data: tm }] = await Promise.all([
    supabase.from('payments').select('amount_cents, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()),
    supabase.from('invoices').select('id, appointment_id'),
    supabase.from('appointments').select('id, practitioner_id'),
    supabase.from('team_members').select('id, full_name, color'),
  ])
  payments.value = p ?? []
  invoices.value = inv ?? []
  appointments.value = appt ?? []
  teamMembers.value = tm ?? []
  loading.value = false
}
onMounted(load)
watch(range, load)

const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))

function monthKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}
const monthKeys = computed(() => monthKeysInRange(range.value))

function practitionerFor(payment: PaymentRow): string {
  const invoice = invoiceById.value.get(payment.invoice_id)
  const appt = invoice?.appointment_id ? appointmentById.value.get(invoice.appointment_id) : undefined
  return appt?.practitioner_id ?? '__unassigned'
}

const series = computed(() => {
  const byPractitioner = new Map<string, Map<string, number>>()
  for (const p of payments.value) {
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
      label: member?.full_name ?? 'Unassigned',
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
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Income Performance</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Compare practitioners month over month and track growth.</p>

    <div class="mt-4">
      <ReportsDateRangeSelect v-model="range" :presets="PRESETS" />
    </div>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
    <div v-else-if="payments.length === 0" class="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">
      No payments recorded yet — this fills in once invoices are being paid.
    </div>
    <template v-else>
      <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 class="text-sm font-semibold text-gray-900">Revenue by practitioner, by month</h3>
        <div class="mt-3 h-80"><Line :data="chartData" :options="chartOptions" /></div>
      </div>
      <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 class="text-sm font-semibold text-gray-900">Total over range</h3>
        <ul class="mt-2 space-y-1.5 text-sm">
          <li v-for="row in totalsByPractitioner" :key="row.label" class="flex items-center justify-between">
            <span class="text-gray-700">{{ row.label }}</span>
            <span class="font-medium text-gray-900">€{{ row.total.toFixed(2) }}</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
