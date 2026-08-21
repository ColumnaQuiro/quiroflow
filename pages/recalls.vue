<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type Recall = Tables<'recall_candidates'>
type TeamMember = Pick<Tables<'team_members'>, 'id' | 'full_name'>
type ContactLogRow = Pick<Tables<'contact_log'>, 'patient_id' | 'action' | 'created_at'>

const supabase = useSupabaseClient()
const store = useAccountStore()

const recalls = ref<Recall[]>([])
const teamMembers = ref<TeamMember[]>([])
const lastActionByPatient = ref<Record<string, ContactLogRow>>({})
const hasPhoneByPatient = ref<Record<string, boolean>>({})
const loading = ref(true)

const search = ref('')
const practitionerFilter = ref('')
const overdueOnly = ref(true) // "3+ weeks overdue" chip -- on by default per design spec
const balanceFilter = ref<'any' | 'credit' | 'debit'>('any')
const tagFilter = ref('')
const notContactedOnly = ref(false)

// Contact history and phone-on-file are fetched for every recall candidate
// up front (not just the currently-filtered rows) so the "Not contacted
// yet" chip can filter on them without a circular fetch-then-filter loop.
async function loadContactContext() {
  const ids = recalls.value.map((r) => r.patient_id!).filter(Boolean).slice(0, 300)
  if (ids.length === 0) {
    lastActionByPatient.value = {}
    hasPhoneByPatient.value = {}
    return
  }
  const [{ data: logs }, { data: phones }] = await Promise.all([
    supabase
      .from('contact_log')
      .select('patient_id, action, created_at')
      .in('patient_id', ids)
      .order('created_at', { ascending: false }),
    supabase.from('patients').select('id, has_phone').in('id', ids),
  ])
  const map: Record<string, ContactLogRow> = {}
  for (const row of logs ?? []) {
    if (!map[row.patient_id]) map[row.patient_id] = row
  }
  lastActionByPatient.value = map
  const phoneMap: Record<string, boolean> = {}
  for (const p of phones ?? []) phoneMap[p.id] = p.has_phone
  hasPhoneByPatient.value = phoneMap
}

async function load() {
  loading.value = true
  const [{ data: recallData }, { data: members }] = await Promise.all([
    supabase.from('recall_candidates').select('*'),
    supabase.from('team_members').select('id, full_name').order('full_name'),
  ])
  recalls.value = recallData ?? []
  teamMembers.value = members ?? []
  await loadContactContext()
  loading.value = false
}
onMounted(load)

const filtered = computed(() => {
  return recalls.value
    .filter((r) => {
      if (search.value) {
        const name = `${r.first_name} ${r.last_name ?? ''}`.toLowerCase()
        if (!name.includes(search.value.toLowerCase())) return false
      }
      if (practitionerFilter.value && r.default_practitioner_id !== practitionerFilter.value) return false
      if (overdueOnly.value && (r.days_since_last_appointment ?? 0) < 21) return false
      if (balanceFilter.value === 'credit' && (r.balance_cents ?? 0) <= 0) return false
      if (balanceFilter.value === 'debit' && (r.balance_cents ?? 0) >= 0) return false
      if (tagFilter.value && !(r.tags ?? []).some((t) => t.toLowerCase().includes(tagFilter.value.toLowerCase()))) return false
      if (notContactedOnly.value && lastActionByPatient.value[r.patient_id!]) return false
      return true
    })
    .sort((a, b) => {
      if (!!a.recall_priority !== !!b.recall_priority) return a.recall_priority ? -1 : 1
      return (b.days_since_last_appointment ?? 0) - (a.days_since_last_appointment ?? 0)
    })
})

function practitionerName(id: string | null) {
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? 'Unassigned'
}

function initials(r: Recall) {
  const a = r.first_name?.[0] ?? ''
  const b = r.last_name?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}

function balanceInfo(cents: number | null) {
  const c = cents ?? 0
  const amount = (Math.abs(c) / 100).toFixed(2)
  if (c < 0) return { text: `€${amount}`, class: 'text-danger-text' }
  if (c > 0) return { text: `€${amount} CR`, class: 'text-success-text' }
  return { text: '€0.00', class: 'text-ink-faint' }
}

function overdueInfo(days: number | null) {
  const d = days ?? 0
  const weeks = Math.floor(d / 7)
  const label = `${weeks} wk${weeks === 1 ? '' : 's'} overdue`
  if (d >= 56) return { class: 'bg-danger-bg text-danger-text', label }
  if (d >= 28) return { class: 'bg-warning-bg text-warning-text', label }
  return { class: 'bg-chip-bg2 text-chip-text', label }
}

function shortDate(iso: string) {
  const d = new Date(iso)
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${month} ${String(d.getDate()).padStart(2, '0')}`
}

const actionLabels: Record<string, string> = {
  sent_whatsapp: 'WhatsApp sent',
  called_no_answer: 'Called, no answer',
  called_left_message: 'Left a message',
  booked: 'Booked',
  other: 'Contacted',
}

function lastActionText(r: Recall) {
  const entry = lastActionByPatient.value[r.patient_id!]
  if (entry) return `${actionLabels[entry.action] ?? entry.action} ${shortDate(entry.created_at)}`
  const hasPhone = hasPhoneByPatient.value[r.patient_id!] ?? false
  if (!hasPhone && !r.email) return 'Missing phone and email'
  return 'No contact yet'
}

async function refreshLastAction(patientId: string) {
  const { data } = await supabase
    .from('contact_log')
    .select('patient_id, action, created_at')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data) lastActionByPatient.value = { ...lastActionByPatient.value, [patientId]: data }
}

async function logAction(patientId: string, action: string) {
  await supabase.from('contact_log').insert({
    account_id: store.accountId!,
    patient_id: patientId,
    action,
  })
  await refreshLastAction(patientId)
}

async function togglePriority(recall: Recall) {
  const next = !recall.recall_priority
  await supabase.from('patients').update({ recall_priority: next }).eq('id', recall.patient_id!)
  recall.recall_priority = next
}

async function dismiss(recall: Recall) {
  if (!confirm(`Remove ${recall.first_name} from recalls?`)) return
  await supabase.from('patients').update({ recall_status: 'dismissed' }).eq('id', recall.patient_id!)
  recalls.value = recalls.value.filter((r) => r.patient_id !== recall.patient_id)
}

function onRowAction(recall: Recall, e: Event) {
  const select = e.target as HTMLSelectElement
  const value = select.value
  select.value = ''
  if (value === 'whatsapp') openWhatsApp(recall)
  else if (value === 'priority') togglePriority(recall)
  else if (value === 'dismiss') dismiss(recall)
  else if (value) logAction(recall.patient_id!, value)
}

// --- Send WhatsApp modal (single patient) ---
const sendingTo = ref<Recall | null>(null)

function openWhatsApp(recall: Recall) {
  sendingTo.value = recall
}
function onSent() {
  if (sendingTo.value) refreshLastAction(sendingTo.value.patient_id!)
  sendingTo.value = null
}

// --- Bulk selection (Gmail-style: select-all applies to the current
// filtered view, individual rows can be de-selected) ---
const selectedIds = ref<Set<string>>(new Set())
const allVisibleSelected = computed(() => filtered.value.length > 0 && filtered.value.every((r) => selectedIds.value.has(r.patient_id!)))
const selectedRecalls = computed(() => filtered.value.filter((r) => selectedIds.value.has(r.patient_id!)))

function toggleSelectAll() {
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) {
    for (const r of filtered.value) next.delete(r.patient_id!)
  } else {
    for (const r of filtered.value) next.add(r.patient_id!)
  }
  selectedIds.value = next
}
function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function clearSelection() {
  selectedIds.value = new Set()
}

const bulkWhatsAppOpen = ref(false)
function onBulkSent() {
  for (const r of selectedRecalls.value) refreshLastAction(r.patient_id!)
}
function closeBulkWhatsApp() {
  bulkWhatsAppOpen.value = false
  selectedIds.value = new Set()
}

// --- Bulk: assign to practitioner. Wired for real -- patients (and this
// view) already have a default_practitioner_id column and the single-row
// flow already writes to it, so this just applies the same update to every
// selected patient. ---
const assignMenuOpen = ref(false)
async function bulkAssignPractitioner(teamMemberId: string) {
  const ids = selectedRecalls.value.map((r) => r.patient_id!)
  if (ids.length === 0) return
  await supabase.from('patients').update({ default_practitioner_id: teamMemberId }).in('id', ids)
  for (const r of recalls.value) {
    if (ids.includes(r.patient_id!)) r.default_practitioner_id = teamMemberId
  }
  assignMenuOpen.value = false
  selectedIds.value = new Set()
}

// --- Bulk: snooze 30 days. UI-only -- there is no snooze/next-recall-date
// column on patients or recall_candidates to persist this against, and
// adding one is a schema change out of scope for this pass. Left present
// but inert rather than silently pretending to work.
function bulkSnooze() {
  // no-op by design; see comment above
}

// --- Export currently filtered rows to CSV. Client-side only -- it just
// serializes data already loaded for display, nothing is sent anywhere.
function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function exportCsv() {
  const header = ['Patient', 'Last visit', 'Days overdue', 'Practitioner', 'Balance', 'Last action']
  const rows = filtered.value.map((r) => [
    `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    r.last_appointment_at ? new Date(r.last_appointment_at).toLocaleDateString() : '',
    String(r.days_since_last_appointment ?? ''),
    practitionerName(r.default_practitioner_id),
    balanceInfo(r.balance_cents).text,
    lastActionText(r),
  ])
  const csv = [header, ...rows].map((cols) => cols.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `recalls-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Recalls" :meta="`${filtered.length} patient${filtered.length === 1 ? '' : 's'} with no future appointment`">
      <UiBtn variant="secondary" @click="exportCsv">Export</UiBtn>
      <UiBtn variant="primary" :disabled="selectedIds.size === 0" @click="bulkWhatsAppOpen = true">Message selected</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <!-- Filter row -->
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          placeholder="Search by name"
          class="h-8 w-52 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-tintBorder"
        />

        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-pill border px-3 text-[12.5px] font-medium"
          :class="overdueOnly ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
          @click="overdueOnly = !overdueOnly"
        >
          3+ weeks overdue
        </button>

        <div class="relative">
          <select
            v-model="practitionerFilter"
            class="h-7 appearance-none rounded-pill border bg-surface pl-3 pr-7 text-[12.5px] font-medium focus:outline-none"
            :class="practitionerFilter ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-500 hover:border-line-controlHover'"
          >
            <option value="">Any practitioner</option>
            <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
          </select>
          <svg class="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <div class="relative">
          <select
            v-model="balanceFilter"
            class="h-7 appearance-none rounded-pill border bg-surface pl-3 pr-7 text-[12.5px] font-medium focus:outline-none"
            :class="balanceFilter !== 'any' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-500 hover:border-line-controlHover'"
          >
            <option value="any">Any balance</option>
            <option value="debit">Owing</option>
            <option value="credit">In credit</option>
          </select>
          <svg class="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <input
          v-model="tagFilter"
          type="search"
          placeholder="Filter by tag"
          class="h-7 w-32 rounded-pill border border-line-control bg-surface px-3 text-[12.5px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-tintBorder"
        />

        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-pill border px-3 text-[12.5px] font-medium"
          :class="notContactedOnly ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
          @click="notContactedOnly = !notContactedOnly"
        >
          Not contacted yet
        </button>

        <span class="ml-auto text-[12.5px] text-ink-muted2">Sorted by most overdue first</span>
      </div>

      <!-- Table card -->
      <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div v-if="selectedIds.size > 0" class="flex h-11 items-center gap-4 border-b border-chip-border bg-[#F7F7FE] px-4">
          <span class="text-[13px] font-semibold text-brand-text">{{ selectedIds.size }} selected</span>
          <span class="h-4 w-px bg-line-control"></span>
          <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="bulkWhatsAppOpen = true">
            Send WhatsApp recall
          </button>
          <div class="relative">
            <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="assignMenuOpen = !assignMenuOpen">
              Assign to practitioner
            </button>
            <div v-if="assignMenuOpen" class="absolute left-0 top-full z-10 mt-1 w-48 rounded-ctl border border-line bg-surface py-1 shadow-popover">
              <button
                v-for="m in teamMembers"
                :key="m.id"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-600 hover:bg-surface-subtle"
                @click="bulkAssignPractitioner(m.id)"
              >
                {{ m.full_name }}
              </button>
              <p v-if="teamMembers.length === 0" class="px-3 py-1.5 text-[12.5px] text-ink-faint">No practitioners</p>
            </div>
          </div>
          <button
            type="button"
            class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover"
            title="Snoozing recalls isn't available yet"
            @click="bulkSnooze"
          >
            Snooze 30 days
          </button>
          <button type="button" class="ml-auto text-[12.5px] text-ink-muted2 hover:text-ink-500" @click="clearSelection">Clear selection</button>
        </div>

        <table class="w-full text-left text-[13px]">
          <thead>
            <tr class="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <th class="w-[38px] px-4 py-2.5">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  class="h-3.5 w-3.5 rounded-[4px] border-line-control accent-brand"
                  @change="toggleSelectAll"
                />
              </th>
              <th class="px-4 py-2.5">Patient</th>
              <th class="px-4 py-2.5">Last visit</th>
              <th class="px-4 py-2.5">Overdue</th>
              <th class="px-4 py-2.5">Practitioner</th>
              <th class="px-4 py-2.5 text-right">Balance</th>
              <th class="px-4 py-2.5">Last action</th>
              <th class="w-10 px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-row">
            <tr v-if="loading">
              <td colspan="8" class="px-4 py-8 text-center text-ink-faint">Loading…</td>
            </tr>
            <tr v-else-if="filtered.length === 0">
              <td colspan="8" class="px-4 py-8 text-center text-ink-faint">No recalls match these filters.</td>
            </tr>
            <tr v-for="r in filtered" :key="r.patient_id!" class="align-top hover:bg-surface-subtle2">
              <td class="px-4 py-2.5">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(r.patient_id!)"
                  class="h-3.5 w-3.5 rounded-[4px] border-line-control accent-brand"
                  @change="toggleSelect(r.patient_id!)"
                />
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-start gap-2.5">
                  <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
                    {{ initials(r) }}
                  </span>
                  <div>
                    <NuxtLink :to="`/patients/${r.patient_id}`" class="font-medium text-ink-900 hover:text-brand-text">
                      {{ r.first_name }} {{ r.last_name }}
                    </NuxtLink>
                    <div v-if="r.recall_priority || (r.tags ?? []).length > 0" class="mt-1 flex flex-wrap items-center gap-1">
                      <UiPill v-if="r.recall_priority" tone="warning" :dot="true">Priority</UiPill>
                      <span v-for="tag in r.tags" :key="tag" class="rounded bg-chip-bg px-1.5 py-0.5 text-[11px] text-chip-text">{{ tag }}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-2.5 text-ink-muted">
                {{ r.last_appointment_at ? new Date(r.last_appointment_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A' }}
              </td>
              <td class="px-4 py-2.5">
                <span class="inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold" :class="overdueInfo(r.days_since_last_appointment).class">
                  {{ overdueInfo(r.days_since_last_appointment).label }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-ink-muted">{{ practitionerName(r.default_practitioner_id) }}</td>
              <td class="px-4 py-2.5 text-right font-mono" :class="balanceInfo(r.balance_cents).class">{{ balanceInfo(r.balance_cents).text }}</td>
              <td class="px-4 py-2.5 text-[12.5px] text-ink-muted2">{{ lastActionText(r) }}</td>
              <td class="px-4 py-2.5 text-right">
                <select
                  class="h-7 rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px] text-ink-500 focus:outline-none"
                  @change="onRowAction(r, $event)"
                >
                  <option value="">Action…</option>
                  <option value="whatsapp">Send WhatsApp</option>
                  <option value="called_no_answer">Called – no answer</option>
                  <option value="called_left_message">Called – left message</option>
                  <option value="booked">Booked</option>
                  <option value="priority">{{ r.recall_priority ? 'Unmark priority' : 'Mark as high priority' }}</option>
                  <option value="dismiss">Dismiss from recalls</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <SendWhatsAppModal
      v-if="sendingTo"
      :patient-id="sendingTo.patient_id!"
      :patient-first-name="sendingTo.first_name ?? ''"
      :patient-preferred-language="sendingTo.preferred_language ?? undefined"
      :default-template-name="store.whatsappRecallTemplateName"
      @close="sendingTo = null"
      @sent="onSent"
    />

    <BulkSendWhatsAppModal
      v-if="bulkWhatsAppOpen"
      :targets="selectedRecalls.map((r) => ({ patientId: r.patient_id!, firstName: r.first_name ?? '' }))"
      :default-template-name="store.whatsappRecallTemplateName"
      @close="closeBulkWhatsApp"
      @sent="onBulkSent"
    />
  </div>
</template>
