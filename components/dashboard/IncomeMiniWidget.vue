<script setup lang="ts">
import { Line } from 'vue-chartjs'
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface PaymentRow { amount_cents: number; paid_at: string; invoice_id: string }
interface InvoiceRow { id: string; total_cents: number; appointment_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }

const supabase = useSupabaseClient()
const loading = ref(true)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  const [p, inv, appt] = await Promise.all([
    fetchAllRows<PaymentRow>((f, t) =>
      supabase.from('payments').select('amount_cents, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()).range(f, t),
    ),
    fetchAllRows<InvoiceRow>((f, t) =>
      supabase.from('invoices').select('id, total_cents, appointment_id').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).range(f, t),
    ),
    fetchAllRows<AppointmentRow>((f, t) => supabase.from('appointments').select('id, practitioner_id, clinic_id').range(f, t)),
  ])
  payments.value = p
  invoices.value = inv
  appointments.value = appt
  loading.value = false
}
onMounted(load)
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))
const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))

function apptMatchesFilter(appointmentId: string | null): boolean {
  if (!props.practitionerId && !props.clinicId) return true
  const appt = appointmentId ? appointmentById.value.get(appointmentId) : undefined
  if (!appt) return false
  if (props.practitionerId && appt.practitioner_id !== props.practitionerId) return false
  if (props.clinicId && appt.clinic_id !== props.clinicId) return false
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
const monthKeys = computed(() => monthKeysInRange(props.dateRange))
const revenueChartData = computed(() => {
  const totals = new Map<string, number>(monthKeys.value.map((k) => [k, 0]))
  for (const p of filteredPayments.value) {
    const k = monthKey(p.paid_at)
    if (totals.has(k)) totals.set(k, (totals.get(k) ?? 0) + p.amount_cents)
  }
  return {
    labels: monthKeys.value.map((k) => k.slice(5)),
    datasets: [{ data: monthKeys.value.map((k) => (totals.get(k) ?? 0) / 100), borderColor: '#4f46e5', backgroundColor: '#4f46e5', tension: 0.3 }],
  }
})
const chartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

function euros(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else class="text-sm">
    <div class="grid grid-cols-3 gap-2 text-center">
      <div>
        <p class="text-xs text-gray-500">Charged</p>
        <p class="font-semibold text-gray-900">{{ euros(totalCharged) }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500">Paid</p>
        <p class="font-semibold text-gray-900">{{ euros(totalPaid) }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500">Outstanding</p>
        <p class="font-semibold" :class="outstanding > 0 ? 'text-amber-600' : 'text-gray-900'">{{ euros(outstanding) }}</p>
      </div>
    </div>
    <div class="mt-3 h-32">
      <Line :data="revenueChartData" :options="chartOptions" />
    </div>
  </div>
</template>
