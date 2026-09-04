<script setup lang="ts">
import { Line } from 'vue-chartjs'
import { computePresetRange, monthKeysInRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

interface PaymentRow { amount_cents: number; paid_at: string; invoice_id: string }
interface InvoiceRow { id: string; appointment_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
interface TeamMemberRow { id: string; full_name: string; color: string }

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
const practitionerFilter = ref('')
const clinicFilter = ref('')
const loading = ref(true)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)

  const [p, inv, appt, tm] = await Promise.all([
    fetchAllRows<PaymentRow>((f, t) =>
      supabase.from('payments').select('amount_cents, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()).range(f, t),
    ),
    fetchAllRows<InvoiceRow>((f, t) => supabase.from('invoices').select('id, appointment_id').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).range(f, t)),
    fetchAllRows<AppointmentRow>((f, t) => supabase.from('appointments').select('id, practitioner_id, clinic_id').range(f, t)),
    supabase.from('team_members').select('id, full_name, color').then((r) => r.data ?? []),
  ])
  payments.value = p
  invoices.value = inv
  appointments.value = appt
  teamMembers.value = tm
  loading.value = false
}
onMounted(() => {
  load()
  loadFilterOptions()
})
watch(range, load)

const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const appointmentById = computed(() => new Map(appointments.value.map((a) => [a.id, a])))

function apptMatchesFilter(appointmentId: string | null): boolean {
  if (!practitionerFilter.value && !clinicFilter.value) return true
  const appt = appointmentId ? appointmentById.value.get(appointmentId) : undefined
  if (!appt) return false
  if (practitionerFilter.value && appt.practitioner_id !== practitionerFilter.value) return false
  if (clinicFilter.value && appt.clinic_id !== clinicFilter.value) return false
  return true
}
const filteredPayments = computed(() => payments.value.filter((p) => apptMatchesFilter(invoiceById.value.get(p.invoice_id)?.appointment_id ?? null)))

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
  for (const p of filteredPayments.value) {
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
      label: member?.full_name ?? t('Unassigned', 'Sin asignar'),
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
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Income Performance', 'Rendimiento de ingresos')" :meta="t('Compare practitioners month over month', 'Compara profesionales mes a mes')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div v-if="loading" class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <UiSkeleton class="h-4 w-56 rounded-ctlSm" />
        <UiSkeleton class="mt-3 h-80 w-full rounded-ctl" />
      </div>
      <div v-else-if="filteredPayments.length === 0" class="mt-6 rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13px] text-ink-faint2">
        {{ t('No payments recorded yet — this fills in once invoices are being paid.', 'Todavía no hay pagos registrados — esto se completará en cuanto se paguen facturas.') }}
      </div>
      <template v-else>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('Revenue by practitioner, by month', 'Ingresos por profesional, por mes') }}</h3>
          <div class="mt-3 h-80"><Line :data="chartData" :options="chartOptions" /></div>
        </div>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">{{ t('Total over range', 'Total del periodo') }}</h3>
          <ul class="mt-2 space-y-1.5 text-[13px]">
            <li v-for="row in totalsByPractitioner" :key="row.label" class="flex items-center justify-between">
              <span class="text-ink-600">{{ row.label }}</span>
              <span class="font-mono font-medium text-ink-900">€{{ row.total.toFixed(2) }}</span>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </div>
</template>
