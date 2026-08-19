<script setup lang="ts">
import { Bar, Line } from 'vue-chartjs'
import type { Tables } from '~/types/database.types'
import { computePresetRange, monthKeysInRange, rangeBounds, type DateRange } from '~/composables/useDateRangePresets'

type SavedReport = Tables<'custom_reports'>

interface Source { key: string; label: string; groupings: { key: string; label: string }[]; metrics: { key: string; label: string }[] }

const SOURCES: Source[] = [
  {
    key: 'appointments',
    label: 'Appointments',
    metrics: [{ key: 'count', label: 'Count' }],
    groupings: [
      { key: 'month', label: 'Month' },
      { key: 'weekday', label: 'Day of week' },
      { key: 'status', label: 'Status' },
      { key: 'practitioner', label: 'Practitioner' },
      { key: 'appointment_type', label: 'Appointment type' },
    ],
  },
  {
    key: 'payments',
    label: 'Payments',
    metrics: [{ key: 'sum', label: 'Total (€)' }, { key: 'count', label: 'Count' }],
    groupings: [
      { key: 'month', label: 'Month' },
      { key: 'method', label: 'Payment method' },
      { key: 'practitioner', label: 'Practitioner' },
    ],
  },
  {
    key: 'patients',
    label: 'Patients',
    metrics: [{ key: 'count', label: 'Count' }],
    groupings: [
      { key: 'practitioner', label: 'Default practitioner' },
      { key: 'recall_status', label: 'Recall status' },
      { key: 'preferred_language', label: 'Preferred language' },
      { key: 'confirmation_channel', label: 'Confirmation channel' },
    ],
  },
]

const supabase = useSupabaseClient()
const store = useAccountStore()

const sourceKey = ref('appointments')
const source = computed(() => SOURCES.find((s) => s.key === sourceKey.value)!)
const metricKey = ref('count')
const groupByKey = ref('month')
const chartType = ref<'bar' | 'line' | 'table'>('bar')
const range = ref(computePresetRange({ months: 1 }))

watch(sourceKey, (key) => {
  const s = SOURCES.find((x) => x.key === key)!
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
    const { data } = await supabase
      .from('appointments')
      .select('starts_at, status, practitioner_id, appointment_type_id')
      .gte('starts_at', from.toISOString())
      .lte('starts_at', to.toISOString())
    const list = data ?? []
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
    const [{ data: payments }, { data: invoices }, { data: appointments }, { data: members }] = await Promise.all([
      supabase.from('payments').select('amount_cents, method, paid_at, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()),
      supabase.from('invoices').select('id, appointment_id'),
      supabase.from('appointments').select('id, practitioner_id'),
      supabase.from('team_members').select('id, full_name'),
    ])
    const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]))
    const apptById = new Map((appointments ?? []).map((a) => [a.id, a]))
    const memberById = new Map((members ?? []).map((m) => [m.id, m.full_name]))
    const list = payments ?? []

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
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Custom Reports</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Pick a data source, a metric, and how to group it, and get a live chart.</p>

    <div v-if="saved.length > 0" class="mt-4 flex flex-wrap gap-2">
      <div v-for="r in saved" :key="r.id" class="flex items-center gap-1 rounded-full bg-gray-100 pl-3 pr-1 py-1 text-sm">
        <button type="button" class="text-gray-700 hover:text-indigo-600" @click="loadSavedReport(r)">{{ r.name }}</button>
        <button type="button" class="ml-1 rounded-full px-1.5 text-gray-400 hover:bg-gray-200 hover:text-red-600" @click="removeSaved(r)">✕</button>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <label class="block text-xs font-medium text-gray-500">Data source</label>
        <select v-model="sourceKey" class="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option v-for="s in SOURCES" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-500">Metric</label>
        <select v-model="metricKey" class="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option v-for="m in source.metrics" :key="m.key" :value="m.key">{{ m.label }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-500">Group by</label>
        <select v-model="groupByKey" class="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option v-for="g in source.groupings" :key="g.key" :value="g.key">{{ g.label }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-500">Chart</label>
        <select v-model="chartType" class="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="table">Table</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-500">Range</label>
        <div class="mt-1">
          <ReportsDateRangeSelect v-model="range" />
        </div>
      </div>
      <button type="button" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="showSaveDialog = true">
        Save report
      </button>
    </div>

    <div v-if="showSaveDialog" class="mt-3 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
      <input v-model="reportName" type="text" placeholder="Report name" class="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" @keydown.enter="saveReport" />
      <button type="button" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="saveReport">Save</button>
      <button type="button" class="text-sm text-gray-500 hover:text-gray-700" @click="showSaveDialog = false">Cancel</button>
    </div>

    <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div v-if="loading" class="py-12 text-center text-sm text-gray-400">Loading…</div>
      <div v-else-if="rows.length === 0" class="py-12 text-center text-sm text-gray-400">No data for this combination yet.</div>
      <template v-else>
        <div v-if="chartType === 'bar'" class="h-80"><Bar :data="chartData" :options="chartOptions" /></div>
        <div v-else-if="chartType === 'line'" class="h-80"><Line :data="chartData" :options="chartOptions" /></div>
        <table v-else class="w-full text-sm">
          <tbody class="divide-y divide-gray-100">
            <tr v-for="r in rows" :key="r.label">
              <td class="py-1.5 text-gray-700">{{ r.label }}</td>
              <td class="py-1.5 text-right font-medium text-gray-900">{{ r.value }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>
