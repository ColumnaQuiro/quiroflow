<script setup lang="ts">
import Papa from 'papaparse'
import { computePresetRange, rangeBounds, type DateRange } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'

interface ApptRow {
  id: string
  patient_id: string
  starts_at: string
  status: string
  practitioner_id: string | null
  appointment_type_id: string | null
}
interface PaymentRow { amount_cents: number; paid_at: string; invoice_id: string }
interface InvoiceRow { id: string; appointment_id: string | null }
interface TeamMemberRow { id: string; full_name: string }
interface TypeRow { id: string; name: string }

const ICONS = {
  bell: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  squares:
    'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  chartBar:
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  trendingUp: 'M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  billing: 'M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  exclamationTriangle:
    'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  badgeCheck:
    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  arrowDownTray: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
  adjustments:
    'M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75',
}
const groups = [
  {
    label: 'Operations',
    items: [
      { to: '/reports/scheduled-reminders', label: 'Scheduled Reminders', description: 'WhatsApp delivery status and who has confirmed, is pending, or wants to reschedule.', icon: ICONS.bell },
      { to: '/reports/upcoming-visits', label: 'Upcoming Visits', description: 'How appointments are distributed across the month.', icon: ICONS.calendar },
      { to: '/reports/appointment-distribution', label: 'Appointment Distribution', description: 'Which shift/time of day performs best, by volume and completion.', icon: ICONS.squares },
    ],
  },
  {
    label: 'Growth & Performance',
    items: [
      { to: '/reports/statistics', label: 'Statistics', description: 'First visits, reports, revisions, PVA, conversion, and retention.', icon: ICONS.chartBar },
      { to: '/reports/income-performance', label: 'Income Performance', description: 'Compare practitioners and months side by side, with growth curves.', icon: ICONS.trendingUp },
    ],
  },
  {
    label: 'Financial',
    items: [
      { to: '/reports/income', label: 'Income & Payments', description: 'Revenue by day/week/month/year, payment method, practitioner, visit type.', icon: ICONS.billing },
      { to: '/reports/debtors', label: 'Debtors', description: 'Package/bono purchases with no paid invoice, and how much is outstanding.', icon: ICONS.exclamationTriangle },
      { to: '/reports/memberships', label: 'Memberships', description: 'Active membership count, monthly revenue, and failed payments.', icon: ICONS.badgeCheck },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/reports/data-exports', label: 'Data Exports', description: 'Patients missing an email, phone, or a consent/data protection form.', icon: ICONS.arrowDownTray },
      { to: '/reports/custom', label: 'Custom Reports', description: 'Build and save your own report: source, metric, and chart.', icon: ICONS.adjustments },
    ],
  },
]

const supabase = useSupabaseClient()

const range = ref<DateRange>(computePresetRange({ months: 1 }))
const loading = ref(true)
const allAppointments = ref<ApptRow[]>([]) // full history, non-cancelled -- needed for "first ever visit" and rebook lookups
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])
const appointmentTypes = ref<TypeRow[]>([])

const currentBounds = computed(() => rangeBounds(range.value))
const prevBounds = computed(() => {
  const { from, to } = currentBounds.value
  const lengthMs = to.getTime() - from.getTime()
  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - lengthMs)
  return { from: prevFrom, to: prevTo }
})

async function load() {
  loading.value = true
  const { from: prevFrom } = prevBounds.value
  const { to: currentTo } = currentBounds.value

  const [appts, pay, inv, tm, types] = await Promise.all([
    fetchAllRows<ApptRow>((f, t) =>
      supabase.from('appointments').select('id, patient_id, starts_at, status, practitioner_id, appointment_type_id').neq('status', 'cancelled').range(f, t),
    ),
    fetchAllRows<PaymentRow>((f, t) =>
      supabase.from('payments').select('amount_cents, paid_at, invoice_id').gte('paid_at', prevFrom.toISOString()).lte('paid_at', currentTo.toISOString()).range(f, t),
    ),
    fetchAllRows<InvoiceRow>((f, t) =>
      supabase.from('invoices').select('id, appointment_id').gte('created_at', prevFrom.toISOString()).lte('created_at', currentTo.toISOString()).range(f, t),
    ),
    supabase.from('team_members').select('id, full_name').then((r) => r.data ?? []),
    supabase.from('appointment_types').select('id, name').then((r) => r.data ?? []),
  ])
  allAppointments.value = appts
  payments.value = pay
  invoices.value = inv
  teamMembers.value = tm
  appointmentTypes.value = types
  loading.value = false
}
onMounted(load)
watch(range, load)

function inBounds(iso: string, bounds: { from: Date; to: Date }) {
  const d = new Date(iso)
  return d >= bounds.from && d <= bounds.to
}
function eur(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
function eurCompact(cents: number) {
  return `€${Math.round(cents / 100)}`
}

// --- current/previous slices -------------------------------------------
const completedAll = computed(() => allAppointments.value.filter((a) => a.status === 'completed').sort((a, b) => a.starts_at.localeCompare(b.starts_at)))
const currentAppts = computed(() => allAppointments.value.filter((a) => inBounds(a.starts_at, currentBounds.value)))
const prevAppts = computed(() => allAppointments.value.filter((a) => inBounds(a.starts_at, prevBounds.value)))
const currentCompleted = computed(() => currentAppts.value.filter((a) => a.status === 'completed'))
const prevCompleted = computed(() => prevAppts.value.filter((a) => a.status === 'completed'))

const currentPayments = computed(() => payments.value.filter((p) => inBounds(p.paid_at, currentBounds.value)))
const prevPayments = computed(() => payments.value.filter((p) => inBounds(p.paid_at, prevBounds.value)))

const firstApptByPatient = computed(() => {
  const map = new Map<string, ApptRow>()
  for (const a of completedAll.value) if (!map.has(a.patient_id)) map.set(a.patient_id, a)
  return map
})
function newPatientCountIn(bounds: { from: Date; to: Date }) {
  let count = 0
  for (const a of firstApptByPatient.value.values()) if (inBounds(a.starts_at, bounds)) count++
  return count
}

// --- KPIs -----------------------------------------------------------------
const revenueCents = computed(() => currentPayments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const prevRevenueCents = computed(() => prevPayments.value.reduce((sum, p) => sum + p.amount_cents, 0))
const visits = computed(() => currentCompleted.value.length)
const prevVisits = computed(() => prevCompleted.value.length)
const newPatients = computed(() => newPatientCountIn(currentBounds.value))
const prevNewPatients = computed(() => newPatientCountIn(prevBounds.value))
const avgVisitValueCents = computed(() => (visits.value > 0 ? Math.round(revenueCents.value / visits.value) : null))
const prevAvgVisitValueCents = computed(() => (prevVisits.value > 0 ? Math.round(prevRevenueCents.value / prevVisits.value) : null))

function delta(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
interface Kpi { label: string; value: string; delta: number | null }
const kpis = computed<Kpi[]>(() => [
  { label: 'Revenue', value: eur(revenueCents.value), delta: delta(revenueCents.value, prevRevenueCents.value) },
  { label: 'Visits', value: String(visits.value), delta: delta(visits.value, prevVisits.value) },
  { label: 'New patients', value: String(newPatients.value), delta: delta(newPatients.value, prevNewPatients.value) },
  {
    label: 'Avg. visit value',
    value: avgVisitValueCents.value !== null ? eur(avgVisitValueCents.value) : '—',
    delta: avgVisitValueCents.value !== null && prevAvgVisitValueCents.value !== null ? delta(avgVisitValueCents.value, prevAvgVisitValueCents.value) : null,
  },
])

// --- Revenue by week --------------------------------------------------
function mondayOf(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  const day = c.getDay()
  c.setDate(c.getDate() + (day === 0 ? -6 : 1 - day))
  return c
}
interface WeekBucket { key: string; label: string; totalCents: number; projected: boolean; heightPx: number }
const BAR_MAX_HEIGHT = 128
const weeks = computed<WeekBucket[]>(() => {
  const { from, to } = currentBounds.value
  const now = new Date()
  const buckets: { start: Date; end: Date }[] = []
  let cursor = mondayOf(from)
  while (cursor <= to) {
    const end = new Date(cursor)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    buckets.push({ start: new Date(cursor), end })
    cursor = new Date(cursor)
    cursor.setDate(cursor.getDate() + 7)
  }
  const raw = buckets.map((b) => {
    const totalCents = currentPayments.value.filter((p) => {
      const d = new Date(p.paid_at)
      return d >= b.start && d <= b.end
    }).reduce((sum, p) => sum + p.amount_cents, 0)
    return {
      key: b.start.toISOString(),
      label: b.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      totalCents,
      projected: b.end > now,
    }
  })
  const maxCents = Math.max(1, ...raw.map((w) => w.totalCents))
  return raw.map((w) => ({ ...w, heightPx: w.totalCents > 0 ? Math.max(6, Math.round((w.totalCents / maxCents) * BAR_MAX_HEIGHT)) : 2 }))
})

// --- Visits by type ------------------------------------------------------
const typeNameById = computed(() => new Map(appointmentTypes.value.map((t) => [t.id, t.name])))
interface VisitTypeRow { id: string; label: string; count: number; pct: number }
const visitsByType = computed<VisitTypeRow[]>(() => {
  const counts = new Map<string, number>()
  for (const a of currentCompleted.value) {
    const key = a.appointment_type_id ?? '__none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const rows = [...counts.entries()]
    .map(([id, count]) => ({ id, label: id === '__none' ? 'No type' : (typeNameById.value.get(id) ?? 'Unknown'), count, pct: 0 }))
    .sort((a, b) => b.count - a.count)
  const max = Math.max(1, ...rows.map((r) => r.count))
  return rows.map((r) => ({ ...r, pct: Math.round((r.count / max) * 100) }))
})

// --- Practitioner performance --------------------------------------------
const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const apptById = computed(() => new Map(allAppointments.value.map((a) => [a.id, a])))
function practitionerForPayment(p: PaymentRow): string | null {
  const invoice = invoiceById.value.get(p.invoice_id)
  const appt = invoice?.appointment_id ? apptById.value.get(invoice.appointment_id) : undefined
  return appt?.practitioner_id ?? null
}
interface PractitionerRow { id: string; name: string; visits: number; revenueCents: number; showRate: number | null; rebookRate: number | null }
const practitionerPerformance = computed<PractitionerRow[]>(() => {
  const rows: PractitionerRow[] = []
  for (const member of teamMembers.value) {
    const apptsForMember = currentAppts.value.filter((a) => a.practitioner_id === member.id)
    const completed = apptsForMember.filter((a) => a.status === 'completed')
    const noShow = apptsForMember.filter((a) => a.status === 'no_show')
    if (completed.length === 0 && noShow.length === 0) continue

    const revenueCents = currentPayments.value.filter((p) => practitionerForPayment(p) === member.id).reduce((sum, p) => sum + p.amount_cents, 0)
    const showRate = completed.length + noShow.length === 0 ? null : Math.round((completed.length / (completed.length + noShow.length)) * 100)

    const rebooked = completed.filter((visit) =>
      allAppointments.value.some((a) => a.patient_id === visit.patient_id && a.id !== visit.id && new Date(a.starts_at) > new Date(visit.starts_at)),
    ).length
    const rebookRate = completed.length === 0 ? null : Math.round((rebooked / completed.length) * 100)

    rows.push({ id: member.id, name: member.full_name, visits: completed.length, revenueCents, showRate, rebookRate })
  }
  return rows.sort((a, b) => b.revenueCents - a.revenueCents)
})

// --- Export ---------------------------------------------------------------
function exportCsv() {
  const kpiRows = kpis.value.map((k) => ({ Metric: k.label, Value: k.value, 'vs. previous period': k.delta !== null ? `${k.delta > 0 ? '+' : ''}${k.delta}%` : '—' }))
  const weekRows = weeks.value.map((w) => ({ Week: w.label, Revenue: eur(w.totalCents) }))
  const typeRows = visitsByType.value.map((t) => ({ 'Visit type': t.label, Visits: t.count }))
  const practitionerRows = practitionerPerformance.value.map((p) => ({
    Practitioner: p.name,
    Visits: p.visits,
    Revenue: eur(p.revenueCents),
    'Show rate': p.showRate !== null ? `${p.showRate}%` : '',
    'Rebook rate': p.rebookRate !== null ? `${p.rebookRate}%` : '',
  }))

  const sections: [string, unknown[]][] = [
    ['KPIs', kpiRows],
    ['Revenue by week', weekRows],
    ['Visits by type', typeRows],
    ['Practitioner performance', practitionerRows],
  ]
  const csv = sections.map(([title, rows]) => `${title}\n${Papa.unparse(rows)}`).join('\n\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reports-overview_${range.value.from}_${range.value.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function formatHeaderDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const rangeLabel = computed(() => `${formatHeaderDate(range.value.from)} – ${formatHeaderDate(range.value.to)}`)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Reports" :meta="rangeLabel">
      <ReportsDateRangeSelect v-model="range" />
      <UiBtn variant="secondary" size="md" @click="exportCsv">Export CSV</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div v-if="loading" class="py-16 text-center text-[13px] text-ink-faint2">Loading…</div>

      <template v-else>
        <!-- KPI cards -->
        <div class="grid grid-cols-4 gap-4">
          <div v-for="kpi in kpis" :key="kpi.label" class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[12.5px] text-ink-muted2">{{ kpi.label }}</p>
            <p class="mt-2 font-mono text-[23px] font-semibold leading-none text-ink-900">{{ kpi.value }}</p>
            <p
              class="mt-2 text-[12px] font-medium"
              :class="kpi.delta === null ? 'text-ink-faint2' : kpi.delta >= 0 ? 'text-success-text' : 'text-danger-text'"
            >
              {{ kpi.delta === null ? 'No prior-period data' : `${kpi.delta > 0 ? '+' : ''}${kpi.delta}% vs. previous period` }}
            </p>
          </div>
        </div>

        <!-- Revenue by week / Visits by type -->
        <div class="mt-4 grid grid-cols-3 gap-4">
          <div class="col-span-2 rounded-card border border-line bg-surface p-4 shadow-card">
            <div class="flex items-center justify-between">
              <h3 class="text-[13.5px] font-semibold text-ink-800">Revenue by week</h3>
              <div class="flex items-center gap-3 text-[11px] text-ink-muted2">
                <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-brand"></span>Collected</span>
                <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-chart-projected"></span>Partial / in progress</span>
              </div>
            </div>

            <div v-if="weeks.length === 0" class="flex h-[180px] items-center justify-center text-[13px] text-ink-faint2">No weeks in this range.</div>
            <template v-else>
              <div class="mt-4 flex h-[180px] items-end gap-3">
                <div v-for="w in weeks" :key="w.key" class="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                  <span class="font-mono text-[11px] text-ink-600">{{ eurCompact(w.totalCents) }}</span>
                  <div class="w-full max-w-[36px] rounded-t-[3px]" :class="w.projected ? 'bg-chart-projected' : 'bg-brand'" :style="{ height: w.heightPx + 'px' }" />
                </div>
              </div>
              <div class="mt-2 flex gap-3">
                <div v-for="w in weeks" :key="w.key" class="flex-1 text-center text-[11px] text-ink-faint2">{{ w.label }}</div>
              </div>
            </template>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 class="text-[13.5px] font-semibold text-ink-800">Visits by type</h3>
            <div v-if="visitsByType.length === 0" class="flex h-[180px] items-center justify-center text-[13px] text-ink-faint2">No completed visits yet.</div>
            <div v-else class="mt-4 space-y-3.5">
              <div v-for="t in visitsByType" :key="t.id">
                <div class="flex items-baseline justify-between">
                  <span class="text-[13px] text-ink-600">{{ t.label }}</span>
                  <span class="font-mono text-[13px] font-medium text-ink-900">{{ t.count }}</span>
                </div>
                <div class="mt-1.5 h-[5px] w-full rounded-full bg-line-row">
                  <div class="h-[5px] rounded-full bg-brand" :style="{ width: t.pct + '%' }" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Practitioner performance -->
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-800">Practitioner performance</h3>

          <div v-if="practitionerPerformance.length === 0" class="py-8 text-center text-[13px] text-ink-faint2">No practitioner activity in this range yet.</div>
          <table v-else class="mt-3 w-full text-[13px]">
            <thead>
              <tr class="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint2">
                <th class="py-2">Practitioner</th>
                <th class="py-2 text-right">Visits</th>
                <th class="py-2 text-right">Revenue</th>
                <th class="py-2 text-right">Show rate</th>
                <th class="py-2 text-right">Rebook rate</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-row">
              <tr v-for="p in practitionerPerformance" :key="p.id">
                <td class="py-2.5 text-ink-700">{{ p.name }}</td>
                <td class="py-2.5 text-right font-mono text-ink-900">{{ p.visits }}</td>
                <td class="py-2.5 text-right font-mono text-ink-900">{{ eur(p.revenueCents) }}</td>
                <td class="py-2.5 text-right font-mono font-medium" :class="p.showRate !== null ? 'text-success-text' : 'text-ink-faint2'">
                  {{ p.showRate !== null ? `${p.showRate}%` : '—' }}
                </td>
                <td class="py-2.5 text-right font-mono text-ink-700">{{ p.rebookRate !== null ? `${p.rebookRate}%` : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- All reports -->
        <div class="mt-8">
          <IconLinkGrid :groups="groups" />
        </div>
      </template>
    </div>
  </div>
</template>
