<script setup lang="ts">
import { Bar, Line } from 'vue-chartjs'
import type { Tables } from '~/types/database.types'
import { computePresetRange, monthKeysInRange, rangeBounds, type DateRange } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

type SavedReport = Tables<'custom_reports'>

interface Source { key: string; label: string; groupings: { key: string; label: string }[]; metrics: { key: string; label: string }[] }

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const SOURCES = computed<Source[]>(() => [
  {
    key: 'appointments',
    label: t('Appointments', 'Citas'),
    metrics: [{ key: 'count', label: t('Count', 'Recuento') }],
    groupings: [
      { key: 'month', label: t('Month', 'Mes') },
      { key: 'weekday', label: t('Day of week', 'Día de la semana') },
      { key: 'status', label: t('Status', 'Estado') },
      { key: 'practitioner', label: t('Practitioner', 'Profesional') },
      { key: 'appointment_type', label: t('Appointment type', 'Tipo de cita') },
    ],
  },
  {
    key: 'payments',
    label: t('Payments', 'Pagos'),
    metrics: [{ key: 'sum', label: t('Total (€)', 'Total (€)') }, { key: 'count', label: t('Count', 'Recuento') }],
    groupings: [
      { key: 'month', label: t('Month', 'Mes') },
      { key: 'method', label: t('Payment method', 'Método de pago') },
      { key: 'practitioner', label: t('Practitioner', 'Profesional') },
    ],
  },
  {
    key: 'patients',
    label: t('Patients', 'Pacientes'),
    metrics: [{ key: 'count', label: t('Count', 'Recuento') }],
    groupings: [
      { key: 'practitioner', label: t('Default practitioner', 'Profesional habitual') },
      { key: 'recall_status', label: t('Recall status', 'Estado de seguimiento') },
      { key: 'preferred_language', label: t('Preferred language', 'Idioma preferido') },
      { key: 'confirmation_channel', label: t('Confirmation channel', 'Canal de confirmación') },
    ],
  },
])

const sourceKey = ref('appointments')
const source = computed(() => SOURCES.value.find((s) => s.key === sourceKey.value)!)
const metricKey = ref('count')
const groupByKey = ref('month')
const chartType = ref<'bar' | 'line' | 'table'>('bar')
const range = ref(computePresetRange({ months: 1 }))

watch(sourceKey, (key) => {
  const s = SOURCES.value.find((x) => x.key === key)!
  metricKey.value = s.metrics[0].key
  groupByKey.value = s.groupings[0].key
})

const loading = ref(false)
const rows = ref<{ label: string; value: number }[]>([])

function monthKeys() {
  return monthKeysInRange(range.value).map((k) => {
    const [y, m] = k.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  })
}
function monthKeyFor(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

async function run() {
  loading.value = true
  const { from, to } = rangeBounds(range.value)

  if (sourceKey.value === 'appointments') {
    const list = await fetchAllRows((f, t) =>
      supabase
        .from('appointments')
        .select('starts_at, status, practitioner_id, appointment_type_id')
        .gte('starts_at', from.toISOString())
        .lte('starts_at', to.toISOString())
        .range(f, t),
    )
    const [{ data: members }, { data: types }] = await Promise.all([
      supabase.from('team_members').select('id, full_name'),
      supabase.from('appointment_types').select('id, name'),
    ])
    const memberById = new Map((members ?? []).map((m) => [m.id, m.full_name]))
    const typeById = new Map((types ?? []).map((t) => [t.id, t.name]))

    const totals = new Map<string, number>()
    if (groupByKey.value === 'month') {
      for (const k of monthKeys()) totals.set(k, 0)
      for (const a of list) totals.set(monthKeyFor(a.starts_at), (totals.get(monthKeyFor(a.starts_at)) ?? 0) + 1)
    } else if (groupByKey.value === 'weekday') {
      for (const k of WEEKDAY_LABELS) totals.set(k, 0)
      for (const a of list) {
        const d = new Date(a.starts_at).getDay()
        const label = WEEKDAY_LABELS[d === 0 ? 6 : d - 1]
        totals.set(label, (totals.get(label) ?? 0) + 1)
      }
    } else if (groupByKey.value === 'status') {
      for (const a of list) totals.set(a.status, (totals.get(a.status) ?? 0) + 1)
    } else if (groupByKey.value === 'practitioner') {
      for (const a of list) {
        const label = a.practitioner_id ? (memberById.get(a.practitioner_id) ?? 'Unknown') : 'Unassigned'
        totals.set(label, (totals.get(label) ?? 0) + 1)
      }
    } else if (groupByKey.value === 'appointment_type') {
      for (const a of list) {
        const label = a.appointment_type_id ? (typeById.get(a.appointment_type_id) ?? 'Unknown') : 'No type'
        totals.set(label, (totals.get(label) ?? 0) + 1)
      }
    }
    rows.value = [...totals.entries()].map(([label, value]) => ({ label, value }))
  } else if (sourceKey.value === 'payments') {
    const [payments, invoices, appointments, { data: members }] = await Promise.all([
      fetchAllRows((f, t) =>
        supabase.from('payments').select('amount_cents, method, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()).range(f, t),
      ),
      fetchAllRows((f, t) => supabase.from('invoices').select('id, appointment_id').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).range(f, t)),
      fetchAllRows((f, t) => supabase.from('appointments').select('id, practitioner_id').range(f, t)),
      supabase.from('team_members').select('id, full_name'),
    ])
    const invoiceById = new Map(invoices.map((i) => [i.id, i]))
    const apptById = new Map(appointments.map((a) => [a.id, a]))
    const memberById = new Map((members ?? []).map((m) => [m.id, m.full_name]))
    const list = payments

    const totals = new Map<string, number>()
    const bump = (key: string, amountCents: number) => {
      const inc = metricKey.value === 'sum' ? amountCents / 100 : 1
      totals.set(key, (totals.get(key) ?? 0) + inc)
    }
    if (groupByKey.value === 'month') {
      for (const k of monthKeys()) totals.set(k, 0)
      for (const p of list) bump(monthKeyFor(p.paid_at), p.amount_cents)
    } else if (groupByKey.value === 'method') {
      for (const p of list) bump(p.method, p.amount_cents)
    } else if (groupByKey.value === 'practitioner') {
      for (const p of list) {
        const invoice = invoiceById.get(p.invoice_id)
        const appt = invoice?.appointment_id ? apptById.get(invoice.appointment_id) : undefined
        const label = appt?.practitioner_id ? (memberById.get(appt.practitioner_id) ?? 'Unknown') : 'Unassigned'
        bump(label, p.amount_cents)
      }
    }
    rows.value = [...totals.entries()].map(([label, value]) => ({ label, value }))
  } else if (sourceKey.value === 'patients') {
    const { data: patients } = await supabase
      .from('patients')
      .select('default_practitioner_id, recall_status, preferred_language, confirmation_channel')
    const { data: members } = await supabase.from('team_members').select('id, full_name')
    const memberById = new Map((members ?? []).map((m) => [m.id, m.full_name]))
    const list = patients ?? []

    const totals = new Map<string, number>()
    for (const p of list) {
      let label = 'Unknown'
      if (groupByKey.value === 'practitioner') label = p.default_practitioner_id ? (memberById.get(p.default_practitioner_id) ?? 'Unknown') : 'Unassigned'
      else if (groupByKey.value === 'recall_status') label = p.recall_status
      else if (groupByKey.value === 'preferred_language') label = p.preferred_language
      else if (groupByKey.value === 'confirmation_channel') label = p.confirmation_channel
      totals.set(label, (totals.get(label) ?? 0) + 1)
    }
    rows.value = [...totals.entries()].map(([label, value]) => ({ label, value }))
  }

  loading.value = false
}
onMounted(run)
watch([sourceKey, metricKey, groupByKey, range], run)

const chartData = computed(() => ({
  labels: rows.value.map((r) => r.label),
  datasets: [{ label: source.value.metrics.find((m) => m.key === metricKey.value)?.label, data: rows.value.map((r) => r.value), backgroundColor: '#4f46e5', borderColor: '#4f46e5', tension: 0.3 }],
}))
const chartOptions = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }

// Saved reports
const saved = ref<SavedReport[]>([])
async function loadSaved() {
  const { data } = await supabase.from('custom_reports').select('*').order('created_at', { ascending: false })
  saved.value = data ?? []
}
onMounted(loadSaved)

const showSaveDialog = ref(false)
const reportName = ref('')
async function saveReport() {
  if (!reportName.value.trim()) return
  await supabase.from('custom_reports').insert({
    account_id: store.accountId!,
    name: reportName.value.trim(),
    config: { source: sourceKey.value, metric: metricKey.value, groupBy: groupByKey.value, chartType: chartType.value, range: range.value },
    created_by: store.teamMember?.id ?? null,
  })
  reportName.value = ''
  showSaveDialog.value = false
  await loadSaved()
}
function loadSavedReport(r: SavedReport) {
  const c = r.config as any
  sourceKey.value = c.source
  metricKey.value = c.metric
  groupByKey.value = c.groupBy
  chartType.value = c.chartType
  // Older saved reports stored a rangeMonths number instead of a {from,to} range.
  range.value = (c.range as DateRange | undefined) ?? computePresetRange({ months: c.rangeMonths ?? 6 })
}
async function removeSaved(r: SavedReport) {
  if (!confirm(`Delete saved report "${r.name}"?`)) return
  await supabase.from('custom_reports').delete().eq('id', r.id)
  saved.value = saved.value.filter((s) => s.id !== r.id)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Custom Reports" meta="Pick a source, a metric, and how to group it">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; Reports</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div v-if="saved.length > 0" class="flex flex-wrap gap-2">
        <div v-for="r in saved" :key="r.id" class="flex items-center gap-1 rounded-pill bg-chip-bg pl-3 pr-1 py-1 text-[13px]">
          <button type="button" class="text-ink-600 hover:text-brand-text" @click="loadSavedReport(r)">{{ r.name }}</button>
          <button type="button" class="ml-1 rounded-full px-1.5 text-ink-faint2 hover:bg-line-row hover:text-danger-text" @click="removeSaved(r)">✕</button>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Data source</label>
          <select v-model="sourceKey" class="mt-1 h-8 rounded-ctl border border-line-control px-2 text-[13px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
            <option v-for="s in SOURCES" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Metric</label>
          <select v-model="metricKey" class="mt-1 h-8 rounded-ctl border border-line-control px-2 text-[13px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
            <option v-for="m in source.metrics" :key="m.key" :value="m.key">{{ m.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Group by</label>
          <select v-model="groupByKey" class="mt-1 h-8 rounded-ctl border border-line-control px-2 text-[13px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
            <option v-for="g in source.groupings" :key="g.key" :value="g.key">{{ g.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Chart</label>
          <select v-model="chartType" class="mt-1 h-8 rounded-ctl border border-line-control px-2 text-[13px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="table">Table</option>
          </select>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-ink-muted2">Range</label>
          <div class="mt-1">
            <ReportsDateRangeSelect v-model="range" />
          </div>
        </div>
        <UiBtn variant="primary" size="md" @click="showSaveDialog = true">Save report</UiBtn>
      </div>

      <div v-if="showSaveDialog" class="mt-3 flex items-center gap-2 rounded-card border border-brand-tintBorder bg-brand-tint p-3">
        <input v-model="reportName" type="text" placeholder="Report name" class="h-8 flex-1 rounded-ctl border border-line-control px-3 text-[13px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" @keydown.enter="saveReport" />
        <UiBtn variant="primary" size="md" @click="saveReport">Save</UiBtn>
        <button type="button" class="text-[13px] text-ink-muted2 hover:text-ink-600" @click="showSaveDialog = false">Cancel</button>
      </div>

      <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <div v-if="loading" class="py-12 text-center text-[13px] text-ink-faint2">Loading…</div>
        <div v-else-if="rows.length === 0" class="py-12 text-center text-[13px] text-ink-faint2">No data for this combination yet.</div>
        <template v-else>
          <div v-if="chartType === 'bar'" class="h-80"><Bar :data="chartData" :options="chartOptions" /></div>
          <div v-else-if="chartType === 'line'" class="h-80"><Line :data="chartData" :options="chartOptions" /></div>
          <table v-else class="w-full text-[13px]">
            <tbody class="divide-y divide-line-row">
              <tr v-for="r in rows" :key="r.label">
                <td class="py-1.5 text-ink-600">{{ r.label }}</td>
                <td class="py-1.5 text-right font-mono font-medium text-ink-900">{{ r.value }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </div>
  </div>
</template>
