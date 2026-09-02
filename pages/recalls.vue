<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type Recall = Tables<'recall_candidates'>
type TeamMember = Pick<Tables<'team_members'>, 'id' | 'full_name'>
type ContactLogRow = Pick<Tables<'contact_log'>, 'patient_id' | 'action' | 'created_at'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const recalls = ref<Recall[]>([])
const teamMembers = ref<TeamMember[]>([])
const lastActionByPatient = ref<Record<string, ContactLogRow>>({})
const actionCountByPatient = ref<Record<string, number>>({})
const hasPhoneByPatient = ref<Record<string, boolean>>({})
const loading = ref(true)

const search = ref('')
const practitionerFilter = ref('')
const minWeeksOverdue = ref(3) // "N+ weeks overdue" filter -- 3+ on by default per design spec
// Alternative to minWeeksOverdue -- an absolute cutoff ("hasn't been in
// since this date") instead of a rolling N-weeks-from-today window. Takes
// over the overdue calculation entirely when set, since combining a
// relative and an absolute threshold at once has no coherent meaning.
const dateFrom = ref('')
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
  const counts: Record<string, number> = {}
  for (const row of logs ?? []) {
    if (!map[row.patient_id]) map[row.patient_id] = row
    counts[row.patient_id] = (counts[row.patient_id] ?? 0) + 1
  }
  lastActionByPatient.value = map
  actionCountByPatient.value = counts
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
      if (dateFrom.value) {
        if (!r.last_appointment_at || new Date(r.last_appointment_at) > new Date(`${dateFrom.value}T23:59:59`)) return false
      } else if ((r.days_since_last_appointment ?? 0) < minWeeksOverdue.value * 7) {
        return false
      }
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
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? t('Unassigned', 'Sin asignar')
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
  if (c > 0) return { text: `€${amount} ${t('CR', 'CR')}`, class: 'text-success-text' }
  return { text: '€0.00', class: 'text-ink-faint' }
}

function overdueInfo(days: number | null) {
  const d = days ?? 0
  const weeks = Math.floor(d / 7)
  const weekWord = weeks === 1 ? t('wk', 'sem') : t('wks', 'sems')
  const label = `${weeks} ${weekWord} ${t('overdue', 'de retraso')}`
  if (d >= 56) return { class: 'bg-danger-bg text-danger-text', label }
  if (d >= 28) return { class: 'bg-warning-bg text-warning-text', label }
  return { class: 'bg-chip-bg2 text-chip-text', label }
}

function shortDate(iso: string) {
  const d = new Date(iso)
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${month} ${String(d.getDate()).padStart(2, '0')}`
}

const actionLabels: Record<string, [string, string]> = {
  sent_whatsapp: ['WhatsApp sent', 'WhatsApp enviado'],
  called_no_answer: ['Called, no answer', 'Llamada, sin respuesta'],
  called_left_message: ['Left a message', 'Se dejó un mensaje'],
  booked: ['Booked', 'Reservada'],
  other: ['Contacted', 'Contactado'],
}

function lastActionText(r: Recall) {
  const entry = lastActionByPatient.value[r.patient_id!]
  if (entry) {
    const pair = actionLabels[entry.action]
    const label = pair ? t(pair[0], pair[1]) : entry.action
    return `${label} ${shortDate(entry.created_at)}`
  }
  const hasPhone = hasPhoneByPatient.value[r.patient_id!] ?? false
  if (!hasPhone && !r.email) return t('Missing phone and email', 'Falta teléfono y correo electrónico')
  return t('No contact yet', 'Aún sin contacto')
}

async function refreshLastAction(patientId: string) {
  const { data } = await supabase
    .from('contact_log')
    .select('patient_id, action, created_at')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data) {
    lastActionByPatient.value = { ...lastActionByPatient.value, [patientId]: data }
    actionCountByPatient.value = { ...actionCountByPatient.value, [patientId]: (actionCountByPatient.value[patientId] ?? 0) + 1 }
  }
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
  if (!confirm(`${t('Remove', '¿Eliminar a')} ${recall.first_name} ${t('from recalls?', 'de la lista de recordatorios?')}`)) return
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

// --- Contact history modal ---
const historyFor = ref<Recall | null>(null)

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
  const header = [
    t('Patient', 'Paciente'),
    t('Last visit', 'Última visita'),
    t('Days overdue', 'Días de retraso'),
    t('Practitioner', 'Profesional'),
    t('Balance', 'Saldo'),
    t('Last action', 'Última acción'),
  ]
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
    <PageHeader
      :title="t('Recalls', 'Recordatorios')"
      :meta="`${filtered.length} ${filtered.length === 1 ? t('patient', 'paciente') : t('patients', 'pacientes')} ${t('with no future appointment', 'sin cita futura')}`"
    >
      <UiBtn variant="secondary" @click="exportCsv">{{ t('Export', 'Exportar') }}</UiBtn>
      <UiBtn variant="primary" :disabled="selectedIds.size === 0" @click="bulkWhatsAppOpen = true">{{ t('Message selected', 'Enviar mensaje a seleccionados') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <!-- Filter row -->
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          :placeholder="t('Search by name', 'Buscar por nombre')"
          class="h-8 w-52 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-tintBorder"
        />

        <div class="relative">
          <select
            v-model.number="minWeeksOverdue"
            :disabled="!!dateFrom"
            class="h-7 appearance-none rounded-pill border border-brand-tintBorder bg-brand-tint pl-3 pr-7 text-[12.5px] font-medium text-brand-text focus:outline-none disabled:opacity-40"
          >
            <option :value="1">{{ t('1+ weeks overdue', '1+ semanas de retraso') }}</option>
            <option :value="2">{{ t('2+ weeks overdue', '2+ semanas de retraso') }}</option>
            <option :value="3">{{ t('3+ weeks overdue', '3+ semanas de retraso') }}</option>
            <option :value="4">{{ t('4+ weeks overdue', '4+ semanas de retraso') }}</option>
            <option :value="6">{{ t('6+ weeks overdue', '6+ semanas de retraso') }}</option>
            <option :value="8">{{ t('8+ weeks overdue', '8+ semanas de retraso') }}</option>
            <option :value="12">{{ t('12+ weeks overdue', '12+ semanas de retraso') }}</option>
          </select>
          <svg class="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-brand-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <div class="flex items-center gap-1.5">
          <label class="text-[12.5px] text-ink-muted2">{{ t('No visit since', 'Sin visita desde') }}</label>
          <input
            v-model="dateFrom"
            type="date"
            class="h-7 rounded-pill border px-3 text-[12.5px] font-medium focus:outline-none"
            :class="dateFrom ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-500 hover:border-line-controlHover'"
          />
          <button v-if="dateFrom" type="button" class="text-[12px] text-ink-faint hover:text-ink-600" @click="dateFrom = ''">{{ t('Clear', 'Borrar') }}</button>
        </div>

        <div class="relative">
          <select
            v-model="practitionerFilter"
            class="h-7 appearance-none rounded-pill border bg-surface pl-3 pr-7 text-[12.5px] font-medium focus:outline-none"
            :class="practitionerFilter ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-500 hover:border-line-controlHover'"
          >
            <option value="">{{ t('Any practitioner', 'Cualquier profesional') }}</option>
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
            <option value="any">{{ t('Any balance', 'Cualquier saldo') }}</option>
            <option value="debit">{{ t('Owing', 'Pendiente') }}</option>
            <option value="credit">{{ t('In credit', 'A favor') }}</option>
          </select>
          <svg class="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <input
          v-model="tagFilter"
          type="search"
          :placeholder="t('Filter by tag', 'Filtrar por etiqueta')"
          class="h-7 w-32 rounded-pill border border-line-control bg-surface px-3 text-[12.5px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-tintBorder"
        />

        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-pill border px-3 text-[12.5px] font-medium"
          :class="notContactedOnly ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
          @click="notContactedOnly = !notContactedOnly"
        >
          {{ t('Not contacted yet', 'Sin contactar aún') }}
        </button>

        <span class="ml-auto text-[12.5px] text-ink-muted2">{{ t('Sorted by most overdue first', 'Ordenado por mayor retraso primero') }}</span>
      </div>

      <!-- Table card -->
      <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div v-if="selectedIds.size > 0" class="flex h-11 items-center gap-4 border-b border-chip-border bg-[#F7F7FE] px-4">
          <span class="text-[13px] font-semibold text-brand-text">{{ selectedIds.size }} {{ t('selected', 'seleccionados') }}</span>
          <span class="h-4 w-px bg-line-control"></span>
          <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="bulkWhatsAppOpen = true">
            {{ t('Send WhatsApp recall', 'Enviar recordatorio por WhatsApp') }}
          </button>
          <div class="relative">
            <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="assignMenuOpen = !assignMenuOpen">
              {{ t('Assign to practitioner', 'Asignar a profesional') }}
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
              <p v-if="teamMembers.length === 0" class="px-3 py-1.5 text-[12.5px] text-ink-faint">{{ t('No practitioners', 'Sin profesionales') }}</p>
            </div>
          </div>
          <button
            type="button"
            class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover"
            :title="t(&quot;Snoozing recalls isn't available yet&quot;, 'Posponer recordatorios aún no está disponible')"
            @click="bulkSnooze"
          >
            {{ t('Snooze 30 days', 'Posponer 30 días') }}
          </button>
          <button type="button" class="ml-auto text-[12.5px] text-ink-muted2 hover:text-ink-500" @click="clearSelection">{{ t('Clear selection', 'Borrar selección') }}</button>
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
              <th class="px-4 py-2.5">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-4 py-2.5">{{ t('Last visit', 'Última visita') }}</th>
              <th class="px-4 py-2.5">{{ t('Overdue', 'Retraso') }}</th>
              <th class="px-4 py-2.5">{{ t('Practitioner', 'Profesional') }}</th>
              <th class="px-4 py-2.5 text-right">{{ t('Balance', 'Saldo') }}</th>
              <th class="px-4 py-2.5">{{ t('Last action', 'Última acción') }}</th>
              <th class="w-10 px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-row">
            <template v-if="loading">
              <tr v-for="i in 6" :key="i" class="align-top">
                <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-3.5 rounded-[4px]" /></td>
                <td class="px-4 py-2.5">
                  <div class="flex items-start gap-2.5">
                    <UiSkeleton class="h-8 w-8 shrink-0 rounded-full" />
                    <UiSkeleton class="mt-1 h-3.5 w-32 rounded" />
                  </div>
                </td>
                <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-20 rounded" /></td>
                <td class="px-4 py-2.5"><UiSkeleton class="h-4 w-16 rounded-pill" /></td>
                <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-24 rounded" /></td>
                <td class="px-4 py-2.5 text-right"><UiSkeleton class="ml-auto h-3.5 w-16 rounded" /></td>
                <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-28 rounded" /></td>
                <td class="px-4 py-2.5 text-right"><UiSkeleton class="ml-auto h-7 w-8 rounded-ctlSm" /></td>
              </tr>
            </template>
            <tr v-else-if="filtered.length === 0">
              <td colspan="8" class="px-4 py-8 text-center text-ink-faint">{{ t('No recalls match these filters.', 'Ningún recordatorio coincide con estos filtros.') }}</td>
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
                      <UiPill v-if="r.recall_priority" tone="warning" :dot="true">{{ t('Priority', 'Prioridad') }}</UiPill>
                      <span v-for="tag in r.tags" :key="tag" class="rounded bg-chip-bg px-1.5 py-0.5 text-[11px] text-chip-text">{{ tag }}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-2.5 text-ink-muted">
                {{ r.last_appointment_at ? new Date(r.last_appointment_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : t('N/A', 'N/D') }}
              </td>
              <td class="px-4 py-2.5">
                <span class="inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold" :class="overdueInfo(r.days_since_last_appointment).class">
                  {{ overdueInfo(r.days_since_last_appointment).label }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-ink-muted">{{ practitionerName(r.default_practitioner_id) }}</td>
              <td class="px-4 py-2.5 text-right font-mono" :class="balanceInfo(r.balance_cents).class">{{ balanceInfo(r.balance_cents).text }}</td>
              <td class="px-4 py-2.5 text-[12.5px]">
                <button
                  v-if="actionCountByPatient[r.patient_id!]"
                  type="button"
                  class="text-left text-brand-text hover:underline"
                  @click="historyFor = r"
                >
                  {{ lastActionText(r) }}
                  <span class="text-ink-faint2">· {{ actionCountByPatient[r.patient_id!] }} {{ actionCountByPatient[r.patient_id!] === 1 ? t('action', 'acción') : t('actions', 'acciones') }}</span>
                </button>
                <span v-else class="text-ink-muted2">{{ lastActionText(r) }}</span>
              </td>
              <td class="px-4 py-2.5 text-right">
                <select
                  class="h-7 rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px] text-ink-500 focus:outline-none"
                  @change="onRowAction(r, $event)"
                >
                  <option value="">{{ t('Action…', 'Acción…') }}</option>
                  <option value="whatsapp">{{ t('Send WhatsApp', 'Enviar WhatsApp') }}</option>
                  <option value="called_no_answer">{{ t('Called – no answer', 'Llamado – sin respuesta') }}</option>
                  <option value="called_left_message">{{ t('Called – left message', 'Llamado – mensaje dejado') }}</option>
                  <option value="booked">{{ t('Booked', 'Reservada') }}</option>
                  <option value="priority">{{ r.recall_priority ? t('Unmark priority', 'Quitar prioridad') : t('Mark as high priority', 'Marcar como alta prioridad') }}</option>
                  <option value="dismiss">{{ t('Dismiss from recalls', 'Descartar de recordatorios') }}</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ContactHistoryModal
      v-if="historyFor"
      :patient-id="historyFor.patient_id!"
      :patient-name="`${historyFor.first_name ?? ''} ${historyFor.last_name ?? ''}`.trim()"
      @close="historyFor = null"
    />

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
