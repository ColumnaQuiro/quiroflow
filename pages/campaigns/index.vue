<script setup lang="ts">
interface Rule {
  id: string
  name: string
  trigger_event: string
  enabled: boolean
}
interface Action {
  rule_id: string
  action_type: string
  config: Record<string, any>
}
interface PatientOption { id: string; first_name: string; last_name: string | null }
interface WaMsgRow { template_name: string | null; status: string; direction: string; purpose: string | null; created_at: string }
interface TemplateStat { sent: number; delivered: number; failed: number; lastFired: string | null }

const TRIGGER_LABELS: Record<string, string> = {
  'appointment.checked_in': 'Patient checked in',
  'appointment.booked': 'Appointment booked',
  'appointment.completed': 'Appointment completed',
  'appointment.cancelled': 'Appointment cancelled',
  'appointment.no_show': 'Appointment marked as missed',
  'invoice.paid': 'Invoice paid',
}
// Plain-language description shown in the expanded row's Trigger card.
const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  'appointment.checked_in': 'Fires the moment front desk checks a patient in for their visit.',
  'appointment.booked': 'Fires as soon as a new appointment is booked, in-app or online.',
  'appointment.completed': 'Fires right after a visit is marked completed.',
  'appointment.cancelled': 'Fires when an appointment is cancelled.',
  'appointment.no_show': 'Fires when an appointment is marked as a missed visit.',
  'invoice.paid': 'Fires once an invoice is marked paid in full.',
}
const ACTION_LABELS: Record<string, string> = {
  whatsapp_template: 'WhatsApp',
  email: 'Email',
  webhook: 'Webhook',
}
const ACTION_TONE: Record<string, 'success' | 'brand' | 'neutral'> = {
  whatsapp_template: 'success',
  email: 'brand',
  webhook: 'neutral',
}

const supabase = useSupabaseClient()

const rules = ref<Rule[]>([])
const actionsByRule = ref<Record<string, Action[]>>({})
const loading = ref(true)
const modalOpen = ref(false)
const editingRuleId = ref<string | null>(null)
const expandedId = ref<string | null>(null)

// Only "chain rows" (variant A) is implemented -- the board/kanban layout
// from the handoff (variant B) isn't built, so the second toggle option is
// present but inert rather than faked.
const layoutMode = ref<'chain' | 'board'>('chain')

const enabledCount = computed(() => rules.value.filter((r) => r.enabled).length)

async function load() {
  loading.value = true
  const { data: ruleRows } = await supabase.from('automation_rules').select('id, name, trigger_event, enabled').order('created_at', { ascending: false })
  rules.value = ruleRows ?? []

  const ids = rules.value.map((r) => r.id)
  if (ids.length > 0) {
    const { data: actionRows } = await supabase.from('automation_actions').select('rule_id, action_type, config').in('rule_id', ids).order('position')
    const grouped: Record<string, Action[]> = {}
    for (const a of actionRows ?? []) {
      ;(grouped[a.rule_id] ??= []).push(a)
    }
    actionsByRule.value = grouped
  } else {
    actionsByRule.value = {}
  }
  loading.value = false
}

// --- Delivery stats -------------------------------------------------------
// The only send channel with any delivery tracking today is WhatsApp: Meta's
// status webhook (server/api/whatsapp/webhook.post.ts) updates whatsapp_messages
// rows with sent/delivered/read/failed as callbacks arrive, and automation
// sends are tagged purpose:'other' there (vs. 'confirmation'/'recall' for the
// existing appointment-reminder flows). Email and webhook actions have no
// equivalent log table, so their contribution to these numbers is genuinely
// zero rather than estimated -- we show 0/"—" for those instead of inventing
// figures. Per-campaign numbers are joined by template_name since
// whatsapp_messages doesn't carry a rule_id; this can blur two campaigns that
// happen to reuse the exact same WhatsApp template name.
const globalStats = ref<{ sent: number; deliveredPct: number | null; failed: number; replies: number }>({ sent: 0, deliveredPct: null, failed: 0, replies: 0 })
const templateStats = ref<Record<string, TemplateStat>>({})

async function loadStats() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('template_name, status, direction, purpose, created_at')
    .gte('created_at', since)
  const rows = (data ?? []) as WaMsgRow[]

  const outbound = rows.filter((r) => r.direction === 'outbound' && r.purpose === 'other')
  const delivered = outbound.filter((r) => r.status === 'delivered' || r.status === 'read')
  const failed = outbound.filter((r) => r.status === 'failed')
  // Inbound replies aren't linked to a triggering rule/template at all, so
  // this can only be an account-wide count, not a per-campaign one.
  const replies = rows.filter((r) => r.direction === 'inbound')

  globalStats.value = {
    sent: outbound.length,
    deliveredPct: outbound.length ? Math.round((delivered.length / outbound.length) * 1000) / 10 : null,
    failed: failed.length,
    replies: replies.length,
  }

  const byTemplate: Record<string, TemplateStat> = {}
  for (const r of outbound) {
    if (!r.template_name) continue
    const bucket = (byTemplate[r.template_name] ??= { sent: 0, delivered: 0, failed: 0, lastFired: null })
    bucket.sent++
    if (r.status === 'delivered' || r.status === 'read') bucket.delivered++
    if (r.status === 'failed') bucket.failed++
    if (!bucket.lastFired || r.created_at > bucket.lastFired) bucket.lastFired = r.created_at
  }
  templateStats.value = byTemplate
}

onMounted(() => {
  load()
  loadStats()
})

function ruleWhatsappTemplateNames(rule: Rule): string[] {
  return (actionsByRule.value[rule.id] ?? [])
    .filter((a) => a.action_type === 'whatsapp_template')
    .map((a) => a.config?.template_name)
    .filter((n): n is string => !!n)
}
const ruleStatsMap = computed(() => {
  const map: Record<string, { sent: number; deliveredPct: number | null; lastFired: string | null }> = {}
  for (const rule of rules.value) {
    const names = ruleWhatsappTemplateNames(rule)
    let sent = 0
    let delivered = 0
    let lastFired: string | null = null
    for (const n of names) {
      const s = templateStats.value[n]
      if (!s) continue
      sent += s.sent
      delivered += s.delivered
      if (s.lastFired && (!lastFired || s.lastFired > lastFired)) lastFired = s.lastFired
    }
    map[rule.id] = { sent, deliveredPct: sent ? Math.round((delivered / sent) * 1000) / 10 : null, lastFired }
  }
  return map
})

function formatLastFired(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function actionTitle(a: Action): string {
  if (a.action_type === 'whatsapp_template') return a.config?.template_name || '(no template set)'
  if (a.action_type === 'email') return a.config?.subject || '(no subject)'
  return a.config?.url || '(no URL set)'
}
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
function actionSummary(a: Action): string {
  if (a.action_type === 'whatsapp_template') {
    const varCount = Array.isArray(a.config?.variables) ? a.config.variables.length : 0
    const parts = [`${varCount} variable${varCount === 1 ? '' : 's'}`]
    if (a.config?.doc_template_id) parts.push('document attached')
    return parts.join(' · ')
  }
  if (a.action_type === 'email') {
    const text = stripHtml(a.config?.body || '')
    return text ? (text.length > 90 ? `${text.slice(0, 90)}…` : text) : 'No body written yet.'
  }
  return a.config?.secret ? 'Signed with a secret' : 'No signature configured'
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function openCreate() {
  editingRuleId.value = null
  modalOpen.value = true
}
function openEdit(rule: Rule) {
  editingRuleId.value = rule.id
  modalOpen.value = true
}
async function onSaved() {
  modalOpen.value = false
  await Promise.all([load(), loadStats()])
}

async function toggleEnabled(rule: Rule) {
  await supabase.from('automation_rules').update({ enabled: !rule.enabled }).eq('id', rule.id)
  await load()
}
async function removeRule(rule: Rule) {
  if (!confirm(`Delete "${rule.name}"?`)) return
  await supabase.from('automation_rules').delete().eq('id', rule.id)
  if (expandedId.value === rule.id) expandedId.value = null
  await load()
}

// --- Header-level "Send now" -----------------------------------------------
// Distinct from the per-campaign send-now flow this reuses: this is a
// campaign picker + patient search that isn't scoped to any one row.
const sendNowPanelOpen = ref(false)
const sendNowForId = ref<string | null>(null)
const patientQuery = ref('')
const patients = ref<PatientOption[]>([])
const sending = ref(false)
const sentMessage = ref('')

function openSendNowPanel() {
  sendNowPanelOpen.value = true
}
function closeSendNowPanel() {
  sendNowPanelOpen.value = false
  sendNowForId.value = null
  patientQuery.value = ''
  patients.value = []
  sentMessage.value = ''
}
function onSendNowCampaignChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  sendNowForId.value = id || null
  patientQuery.value = ''
  patients.value = []
  sentMessage.value = ''
}
let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(patientQuery, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(async () => {
    if (!patientQuery.value.trim()) {
      patients.value = []
      return
    }
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .or(`first_name.ilike.%${patientQuery.value}%,last_name.ilike.%${patientQuery.value}%`)
      .limit(8)
    patients.value = data ?? []
  }, 250)
})
async function sendNow(patient: PatientOption) {
  if (!sendNowForId.value) return
  sending.value = true
  try {
    await $fetch('/api/automations/send-now', { method: 'POST', body: { ruleId: sendNowForId.value, patientId: patient.id } })
    sentMessage.value = `Sent to ${patient.first_name} ${patient.last_name ?? ''}`
    patientQuery.value = ''
    patients.value = []
  } catch {
    sentMessage.value = 'Failed to send.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Campaigns" :meta="`${enabledCount} of ${rules.length} running`">
      <div class="flex items-center gap-0.5 rounded-ctl border border-line-control bg-surface p-0.5">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-ctlSm"
          :class="layoutMode === 'chain' ? 'bg-brand-tint text-brand' : 'text-ink-muted2 hover:bg-surface-subtle'"
          title="Chain rows"
          @click="layoutMode = 'chain'"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <rect x="1.5" y="2.5" width="13" height="3" rx="1" />
            <rect x="1.5" y="6.5" width="13" height="3" rx="1" />
            <rect x="1.5" y="10.5" width="13" height="3" rx="1" />
          </svg>
        </button>
        <button
          type="button"
          disabled
          class="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-ctlSm text-ink-faint3"
          title="Board view — coming soon"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
          </svg>
        </button>
      </div>
      <UiBtn variant="secondary" @click="openSendNowPanel">Send now</UiBtn>
      <UiBtn variant="primary" @click="openCreate">New campaign</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div v-if="sendNowPanelOpen" class="mb-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="flex items-center justify-between">
          <h2 class="text-[13px] font-semibold text-ink-900">Send a campaign now</h2>
          <button type="button" class="text-ink-faint2 hover:text-ink-muted" @click="closeSendNowPanel">✕</button>
        </div>
        <p class="mt-1 text-[12px] text-ink-muted2">Runs one campaign's actions for a single patient right away, skipping its trigger.</p>
        <div class="mt-3 flex flex-wrap items-start gap-3">
          <select
            :value="sendNowForId ?? ''"
            class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @change="onSendNowCampaignChange"
          >
            <option value="" disabled>Choose a campaign…</option>
            <option v-for="r in rules" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <div v-if="sendNowForId" class="min-w-[240px]">
            <input
              v-model="patientQuery"
              type="text"
              placeholder="Search patients…"
              class="h-8 w-72 rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <ul v-if="patients.length > 0" class="mt-1 max-h-40 w-72 overflow-y-auto rounded-ctl border border-line bg-surface shadow-popover">
              <li
                v-for="p in patients"
                :key="p.id"
                class="cursor-pointer px-3 py-1.5 text-[13px] hover:bg-surface-subtle"
                :class="{ 'pointer-events-none opacity-50': sending }"
                @click="sendNow(p)"
              >
                {{ p.first_name }} {{ p.last_name }}
              </li>
            </ul>
            <p v-if="sentMessage" class="mt-1.5 text-[12px]" :class="sentMessage.startsWith('Failed') ? 'text-danger-text' : 'text-success-text'">{{ sentMessage }}</p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-3">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">Sent 30 d</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.sent }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">Delivered %</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.deliveredPct != null ? `${globalStats.deliveredPct}%` : '—' }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">Replies</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.replies }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">Failed</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.failed }}</p>
        </div>
      </div>

      <div class="mt-5">
        <div v-if="loading" class="rounded-card border border-line bg-surface p-6 text-center text-[13px] text-ink-faint">Loading…</div>
        <div v-else-if="rules.length === 0" class="rounded-card border border-line bg-surface p-10 text-center text-[13px] text-ink-faint">
          No campaigns yet. Create one to automate a WhatsApp, email, or webhook send.
        </div>
        <div v-else class="space-y-2.5">
          <div v-for="rule in rules" :key="rule.id" class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div
              role="button"
              tabindex="0"
              class="flex cursor-pointer items-center gap-3 px-4 py-3"
              @click="toggleExpand(rule.id)"
              @keydown.enter="toggleExpand(rule.id)"
            >
              <div
                class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full"
                :class="rule.enabled ? 'bg-brand-tint text-brand' : 'bg-chip-bg2 text-ink-faint3'"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.9 1 3 9.2h3.6L6.2 15 13 6.4H9.3z" /></svg>
              </div>

              <div class="w-[210px] shrink-0">
                <p class="truncate text-[13.5px] font-semibold text-ink-900">{{ rule.name }}</p>
                <p class="mt-0.5 truncate text-[11.5px] text-ink-muted2">All patients</p>
              </div>

              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
                <UiPill tone="neutral" dot class="max-w-[190px] shrink-0 truncate">{{ TRIGGER_LABELS[rule.trigger_event] ?? rule.trigger_event }}</UiPill>
                <span class="shrink-0 text-[18px] leading-none text-[#C9CCD5]">→</span>
                <template v-for="(a, i) in actionsByRule[rule.id] ?? []" :key="i">
                  <UiPill :tone="ACTION_TONE[a.action_type] ?? 'neutral'" class="max-w-[200px] shrink-0 truncate">
                    {{ ACTION_LABELS[a.action_type] ?? a.action_type }}<template v-if="actionTitle(a)"> · {{ actionTitle(a) }}</template>
                  </UiPill>
                </template>
                <span v-if="(actionsByRule[rule.id] ?? []).length === 0" class="shrink-0 text-[12px] text-ink-faint">No actions configured</span>
              </div>

              <div class="w-[120px] shrink-0 text-right">
                <p class="font-mono text-[13px] font-medium text-ink-800">{{ ruleStatsMap[rule.id]?.sent ?? 0 }}</p>
                <p class="text-[11px] text-ink-muted2">
                  sent · {{ ruleStatsMap[rule.id]?.deliveredPct != null ? `${ruleStatsMap[rule.id]!.deliveredPct}%` : '—' }}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                :aria-checked="rule.enabled"
                class="relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full transition-colors"
                :class="rule.enabled ? 'bg-brand' : 'bg-toggle-off'"
                @click.stop="toggleEnabled(rule)"
              >
                <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform" :class="rule.enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'" />
              </button>
            </div>

            <div v-if="expandedId === rule.id" class="border-t border-line-divider bg-surface-subtle2 px-4 py-4">
              <div class="grid grid-cols-[1fr_2fr_180px] gap-3">
                <div class="rounded-card border border-line bg-surface p-3">
                  <h3 class="text-[12px] font-semibold text-ink-700">Trigger</h3>
                  <p class="mt-1.5 text-[12.5px] font-medium text-ink-800">{{ TRIGGER_LABELS[rule.trigger_event] ?? rule.trigger_event }}</p>
                  <p class="mt-1 text-[11.5px] leading-relaxed text-ink-muted2">{{ TRIGGER_DESCRIPTIONS[rule.trigger_event] ?? 'Runs when this event happens.' }}</p>
                </div>

                <div class="rounded-card border border-line bg-surface p-3">
                  <div class="flex items-center justify-between">
                    <h3 class="text-[12px] font-semibold text-ink-700">Actions</h3>
                    <div class="flex items-center gap-3">
                      <button type="button" class="text-[12px] font-medium text-brand-text hover:text-brand-hover" @click.stop="openEdit(rule)">Edit chain</button>
                      <button type="button" class="text-[12px] font-medium text-danger-text hover:underline" @click.stop="removeRule(rule)">Delete</button>
                    </div>
                  </div>
                  <div class="mt-2 space-y-1.5">
                    <div v-for="(a, i) in actionsByRule[rule.id] ?? []" :key="i" class="rounded-ctl border border-line px-3 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <UiPill :tone="ACTION_TONE[a.action_type] ?? 'neutral'">{{ ACTION_LABELS[a.action_type] ?? a.action_type }}</UiPill>
                        <span class="truncate text-[12.5px] font-medium text-ink-700">{{ actionTitle(a) }}</span>
                      </div>
                      <p class="mt-1 truncate text-[11.5px] text-ink-muted2">{{ actionSummary(a) }}</p>
                    </div>
                    <p v-if="(actionsByRule[rule.id] ?? []).length === 0" class="text-[12px] text-ink-faint">No actions configured.</p>
                  </div>
                </div>

                <div class="w-[180px] shrink-0 rounded-card border border-line bg-surface p-3">
                  <h3 class="text-[12px] font-semibold text-ink-700">Last 30 days</h3>
                  <dl class="mt-2 space-y-1.5 text-[12px]">
                    <div class="flex items-center justify-between"><dt class="text-ink-muted2">Sent</dt><dd class="font-mono text-ink-800">{{ ruleStatsMap[rule.id]?.sent ?? 0 }}</dd></div>
                    <div class="flex items-center justify-between">
                      <dt class="text-ink-muted2">Delivered</dt>
                      <dd class="font-mono text-ink-800">{{ ruleStatsMap[rule.id]?.deliveredPct != null ? `${ruleStatsMap[rule.id]!.deliveredPct}%` : '—' }}</dd>
                    </div>
                    <div class="flex items-center justify-between" title="Replies aren't linked to a specific campaign in the data we track today">
                      <dt class="text-ink-muted2">Replies</dt>
                      <dd class="font-mono text-ink-faint">—</dd>
                    </div>
                    <div class="flex items-center justify-between"><dt class="text-ink-muted2">Last fired</dt><dd class="text-ink-800">{{ formatLastFired(ruleStatsMap[rule.id]?.lastFired ?? null) }}</dd></div>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <CampaignsAutomationModal v-if="modalOpen" :rule-id="editingRuleId" @close="modalOpen = false" @saved="onSaved" />
  </div>
</template>
