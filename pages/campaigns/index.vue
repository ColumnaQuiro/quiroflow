<script setup lang="ts">
import { normalizeSearchTerm } from '~/utils/searchText'

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

const TRIGGER_LABEL_DEFS: Record<string, [string, string]> = {
  'appointment.checked_in': ['Patient checked in', 'Paciente registrado (check-in)'],
  'appointment.booked': ['Appointment booked', 'Cita reservada'],
  'appointment.completed': ['Appointment completed', 'Cita completada'],
  'appointment.cancelled': ['Appointment cancelled', 'Cita cancelada'],
  'appointment.no_show': ['Appointment marked as missed', 'Cita marcada como no presentada'],
  'appointment.rescheduled': ['Appointment rescheduled', 'Cita reprogramada'],
  'appointment.same_day': ['Day of appointment (morning send)', 'Día de la cita (envío matutino)'],
  'invoice.paid': ['Invoice paid', 'Factura pagada'],
  'patient.birthday': ["Patient's birthday (daily check)", 'Cumpleaños del paciente (comprobación diaria)'],
  'membership.new_member': ['New membership started', 'Nueva membresía iniciada'],
  'membership.removed': ['Membership cancelled', 'Membresía cancelada'],
  'membership.payment_processed': ['Membership payment processed', 'Pago de membresía procesado'],
}
// Plain-language description shown in the expanded row's Trigger card.
const TRIGGER_DESCRIPTION_DEFS: Record<string, [string, string]> = {
  'appointment.checked_in': ['Fires the moment front desk checks a patient in for their visit.', 'Se activa en el momento en que recepción registra la llegada del paciente.'],
  'appointment.booked': ['Fires as soon as a new appointment is booked, in-app or online.', 'Se activa en cuanto se reserva una nueva cita, desde la app o en línea.'],
  'appointment.completed': ['Fires right after a visit is marked completed.', 'Se activa justo después de marcar una visita como completada.'],
  'appointment.cancelled': ['Fires when an appointment is cancelled.', 'Se activa cuando se cancela una cita.'],
  'appointment.no_show': ['Fires when an appointment is marked as a missed visit.', 'Se activa cuando una cita se marca como visita perdida.'],
  'appointment.rescheduled': ["Fires when an appointment's date or time changes.", 'Se activa cuando cambia la fecha o la hora de una cita.'],
  'appointment.same_day': ['Runs once a day around 9am; fires for any booked appointment happening that day.', 'Se ejecuta una vez al día alrededor de las 9h; se activa para cualquier cita reservada ese día.'],
  'invoice.paid': ['Fires once an invoice is marked paid in full.', 'Se activa cuando una factura se marca como pagada en su totalidad.'],
  'patient.birthday': ["Runs once a day; fires for any patient whose birthday is today.", 'Se ejecuta una vez al día; se activa para cualquier paciente que cumpla años hoy.'],
  'membership.new_member': ['Fires when a patient starts a new membership.', 'Se activa cuando un paciente inicia una nueva membresía.'],
  'membership.removed': ["Fires when a patient's membership is cancelled.", 'Se activa cuando se cancela la membresía de un paciente.'],
  'membership.payment_processed': ['Fires each time a recurring membership charge succeeds via Stripe.', 'Se activa cada vez que un cobro recurrente de membresía se realiza correctamente a través de Stripe.'],
}
const ACTION_LABEL_DEFS: Record<string, [string, string]> = {
  whatsapp_template: ['WhatsApp', 'WhatsApp'],
  email: ['Email', 'Correo electrónico'],
  webhook: ['Webhook', 'Webhook'],
}
const ACTION_TONE: Record<string, 'success' | 'brand' | 'neutral'> = {
  whatsapp_template: 'success',
  email: 'brand',
  webhook: 'neutral',
}

const supabase = useSupabaseClient()
const t = useT()

function triggerLabel(event: string): string {
  const pair = TRIGGER_LABEL_DEFS[event]
  return pair ? t(pair[0], pair[1]) : event
}
function triggerDescription(event: string): string {
  const pair = TRIGGER_DESCRIPTION_DEFS[event]
  return pair ? t(pair[0], pair[1]) : t('Runs when this event happens.', 'Se ejecuta cuando ocurre este evento.')
}
function actionLabel(actionType: string): string {
  const pair = ACTION_LABEL_DEFS[actionType]
  return pair ? t(pair[0], pair[1]) : actionType
}

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
      // config is stored as jsonb (typed Json, so structurally nullable) --
      // in practice it's always a plain object for the 3 action types this
      // app writes (whatsapp_template/email/webhook).
      ;(grouped[a.rule_id] ??= []).push(a as Action)
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
  if (a.action_type === 'whatsapp_template') return a.config?.template_name || t('(no template set)', '(sin plantilla configurada)')
  if (a.action_type === 'email') return a.config?.subject || t('(no subject)', '(sin asunto)')
  return a.config?.url || t('(no URL set)', '(sin URL configurada)')
}
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
function actionSummary(a: Action): string {
  if (a.action_type === 'whatsapp_template') {
    const varCount = Array.isArray(a.config?.variables) ? a.config.variables.length : 0
    const varWord = varCount === 1 ? t('variable', 'variable') : t('variables', 'variables')
    const parts = [`${varCount} ${varWord}`]
    const docCount = Array.isArray(a.config?.doc_template_ids) ? a.config.doc_template_ids.filter(Boolean).length : 0
    if (docCount > 0) parts.push(t(`${docCount} document${docCount === 1 ? '' : 's'} attached`, `${docCount} documento${docCount === 1 ? '' : 's'} adjunto${docCount === 1 ? '' : 's'}`))
    return parts.join(' · ')
  }
  if (a.action_type === 'email') {
    const text = stripHtml(a.config?.body || '')
    return text ? (text.length > 90 ? `${text.slice(0, 90)}…` : text) : t('No body written yet.', 'Aún no se ha escrito el cuerpo del mensaje.')
  }
  return a.config?.secret ? t('Signed with a secret', 'Firmado con una clave secreta') : t('No signature configured', 'Sin firma configurada')
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
  if (!confirm(`${t('Delete', 'Eliminar')} "${rule.name}"?`)) return
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
const sentFailed = ref(false)

function openSendNowPanel() {
  sendNowPanelOpen.value = true
}
function closeSendNowPanel() {
  sendNowPanelOpen.value = false
  sendNowForId.value = null
  patientQuery.value = ''
  patients.value = []
  sentMessage.value = ''
  sentFailed.value = false
}
function onSendNowCampaignChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  sendNowForId.value = id || null
  patientQuery.value = ''
  patients.value = []
  sentMessage.value = ''
  sentFailed.value = false
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
      .ilike('search_name', `%${normalizeSearchTerm(patientQuery.value.trim())}%`)
      .limit(8)
    patients.value = data ?? []
  }, 250)
})
async function sendNow(patient: PatientOption) {
  if (!sendNowForId.value) return
  sending.value = true
  try {
    await useStaffFetch('/api/automations/send-now', { method: 'POST', body: { ruleId: sendNowForId.value, patientId: patient.id } })
    sentMessage.value = `${t('Sent to', 'Enviado a')} ${patient.first_name} ${patient.last_name ?? ''}`
    sentFailed.value = false
    patientQuery.value = ''
    patients.value = []
  } catch {
    sentMessage.value = t('Failed to send.', 'Error al enviar.')
    sentFailed.value = true
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Campaigns', 'Campañas')" :meta="`${enabledCount} ${t('of', 'de')} ${rules.length} ${t('running', 'activas')}`">
      <div class="flex items-center gap-0.5 rounded-ctl border border-line-control bg-surface p-0.5">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-ctlSm"
          :class="layoutMode === 'chain' ? 'bg-brand-tint text-brand' : 'text-ink-muted2 hover:bg-surface-subtle'"
          :title="t('Chain rows', 'Filas en cadena')"
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
          :title="t('Board view — coming soon', 'Vista de tablero — próximamente')"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
          </svg>
        </button>
      </div>
      <UiBtn variant="secondary" @click="openSendNowPanel">{{ t('Send now', 'Enviar ahora') }}</UiBtn>
      <UiBtn variant="primary" @click="openCreate">{{ t('New campaign', 'Nueva campaña') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div v-if="sendNowPanelOpen" class="mb-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="flex items-center justify-between">
          <h2 class="text-[13px] font-semibold text-ink-900">{{ t('Send a campaign now', 'Enviar una campaña ahora') }}</h2>
          <button type="button" class="text-ink-faint2 hover:text-ink-muted" @click="closeSendNowPanel">✕</button>
        </div>
        <p class="mt-1 text-[12px] text-ink-muted2">{{ t("Runs one campaign's actions for a single patient right away, skipping its trigger.", 'Ejecuta de inmediato las acciones de una campaña para un solo paciente, sin esperar a su disparador.') }}</p>
        <div class="mt-3 flex flex-wrap items-start gap-3">
          <select
            :value="sendNowForId ?? ''"
            class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @change="onSendNowCampaignChange"
          >
            <option value="" disabled>{{ t('Choose a campaign…', 'Elige una campaña…') }}</option>
            <option v-for="r in rules" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <div v-if="sendNowForId" class="min-w-[240px]">
            <input
              v-model="patientQuery"
              type="text"
              :placeholder="t('Search patients…', 'Buscar pacientes…')"
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
            <p v-if="sentMessage" class="mt-1.5 text-[12px]" :class="sentFailed ? 'text-danger-text' : 'text-success-text'">{{ sentMessage }}</p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-3">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">{{ t('Sent 30 d', 'Enviados 30 d') }}</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.sent }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">{{ t('Delivered %', 'Entregados %') }}</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.deliveredPct != null ? `${globalStats.deliveredPct}%` : '—' }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">{{ t('Replies', 'Respuestas') }}</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.replies }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[11.5px] font-medium text-ink-muted2">{{ t('Failed', 'Fallidos') }}</p>
          <p class="mt-1.5 font-mono text-[22px] font-semibold text-ink-900">{{ globalStats.failed }}</p>
        </div>
      </div>

      <div class="mt-5">
        <div v-if="loading" class="rounded-card border border-line bg-surface p-6 text-center text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
        <div v-else-if="rules.length === 0" class="rounded-card border border-line bg-surface p-10 text-center text-[13px] text-ink-faint">
          {{ t('No campaigns yet. Create one to automate a WhatsApp, email, or webhook send.', 'Aún no hay campañas. Crea una para automatizar un envío por WhatsApp, correo electrónico o webhook.') }}
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
                <p class="mt-0.5 truncate text-[11.5px] text-ink-muted2">{{ t('All patients', 'Todos los pacientes') }}</p>
              </div>

              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
                <UiPill tone="neutral" dot class="max-w-[190px] shrink-0 truncate">{{ triggerLabel(rule.trigger_event) }}</UiPill>
                <span class="shrink-0 text-[18px] leading-none text-[#C9CCD5]">→</span>
                <template v-for="(a, i) in actionsByRule[rule.id] ?? []" :key="i">
                  <UiPill :tone="ACTION_TONE[a.action_type] ?? 'neutral'" class="shrink-0 whitespace-normal">
                    {{ actionLabel(a.action_type) }}<template v-if="actionTitle(a)"> · {{ actionTitle(a) }}</template>
                  </UiPill>
                </template>
                <span v-if="(actionsByRule[rule.id] ?? []).length === 0" class="shrink-0 text-[12px] text-ink-faint">{{ t('No actions configured', 'Sin acciones configuradas') }}</span>
              </div>

              <div class="w-[120px] shrink-0 text-right">
                <p class="font-mono text-[13px] font-medium text-ink-800">{{ ruleStatsMap[rule.id]?.sent ?? 0 }}</p>
                <p class="text-[11px] text-ink-muted2">
                  {{ t('sent', 'enviados') }} · {{ ruleStatsMap[rule.id]?.deliveredPct != null ? `${ruleStatsMap[rule.id]!.deliveredPct}%` : '—' }}
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
                  <h3 class="text-[12px] font-semibold text-ink-700">{{ t('Trigger', 'Disparador') }}</h3>
                  <p class="mt-1.5 text-[12.5px] font-medium text-ink-800">{{ triggerLabel(rule.trigger_event) }}</p>
                  <p class="mt-1 text-[11.5px] leading-relaxed text-ink-muted2">{{ triggerDescription(rule.trigger_event) }}</p>
                </div>

                <div class="rounded-card border border-line bg-surface p-3">
                  <div class="flex items-center justify-between">
                    <h3 class="text-[12px] font-semibold text-ink-700">{{ t('Actions', 'Acciones') }}</h3>
                    <div class="flex items-center gap-3">
                      <button type="button" class="text-[12px] font-medium text-brand-text hover:text-brand-hover" @click.stop="openEdit(rule)">{{ t('Edit chain', 'Editar cadena') }}</button>
                      <button type="button" class="text-[12px] font-medium text-danger-text hover:underline" @click.stop="removeRule(rule)">{{ t('Delete', 'Eliminar') }}</button>
                    </div>
                  </div>
                  <div class="mt-2 space-y-1.5">
                    <div v-for="(a, i) in actionsByRule[rule.id] ?? []" :key="i" class="rounded-ctl border border-line px-3 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <UiPill :tone="ACTION_TONE[a.action_type] ?? 'neutral'">{{ actionLabel(a.action_type) }}</UiPill>
                        <span class="truncate text-[12.5px] font-medium text-ink-700">{{ actionTitle(a) }}</span>
                      </div>
                      <p class="mt-1 truncate text-[11.5px] text-ink-muted2">{{ actionSummary(a) }}</p>
                    </div>
                    <p v-if="(actionsByRule[rule.id] ?? []).length === 0" class="text-[12px] text-ink-faint">{{ t('No actions configured.', 'Sin acciones configuradas.') }}</p>
                  </div>
                </div>

                <div class="w-[180px] shrink-0 rounded-card border border-line bg-surface p-3">
                  <h3 class="text-[12px] font-semibold text-ink-700">{{ t('Last 30 days', 'Últimos 30 días') }}</h3>
                  <dl class="mt-2 space-y-1.5 text-[12px]">
                    <div class="flex items-center justify-between"><dt class="text-ink-muted2">{{ t('Sent', 'Enviados') }}</dt><dd class="font-mono text-ink-800">{{ ruleStatsMap[rule.id]?.sent ?? 0 }}</dd></div>
                    <div class="flex items-center justify-between">
                      <dt class="text-ink-muted2">{{ t('Delivered', 'Entregados') }}</dt>
                      <dd class="font-mono text-ink-800">{{ ruleStatsMap[rule.id]?.deliveredPct != null ? `${ruleStatsMap[rule.id]!.deliveredPct}%` : '—' }}</dd>
                    </div>
                    <div class="flex items-center justify-between" :title="t('Replies aren\'t linked to a specific campaign in the data we track today', 'Las respuestas no están vinculadas a una campaña específica en los datos que registramos hoy')">
                      <dt class="text-ink-muted2">{{ t('Replies', 'Respuestas') }}</dt>
                      <dd class="font-mono text-ink-faint">—</dd>
                    </div>
                    <div class="flex items-center justify-between"><dt class="text-ink-muted2">{{ t('Last fired', 'Último disparo') }}</dt><dd class="text-ink-800">{{ formatLastFired(ruleStatsMap[rule.id]?.lastFired ?? null) }}</dd></div>
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
