<script setup lang="ts">
const props = defineProps<{ ruleId?: string | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

const TRIGGER_OPTIONS = [
  { value: 'appointment.checked_in', label: 'Patient checked in' },
  { value: 'appointment.booked', label: 'Appointment booked' },
  { value: 'appointment.completed', label: 'Appointment completed' },
  { value: 'appointment.cancelled', label: 'Appointment cancelled' },
  { value: 'appointment.rescheduled', label: 'Appointment rescheduled' },
  { value: 'appointment.no_show', label: 'Appointment marked as missed' },
  { value: 'invoice.paid', label: 'Invoice paid' },
  { value: 'patient.birthday', label: "Patient's birthday (daily check)" },
  { value: 'membership.new_member', label: 'New membership started' },
  { value: 'membership.removed', label: 'Membership cancelled' },
  { value: 'membership.payment_processed', label: 'Membership payment processed' },
]
// These fire with no appointment in scope, same as patient.birthday --
// the appointment-type/visit-count filter block below doesn't apply.
const NO_APPOINTMENT_CONTEXT_TRIGGERS = ['patient.birthday', 'membership.new_member', 'membership.removed', 'membership.payment_processed']
const VARIABLE_SOURCES = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'text', label: 'Fixed text' },
]
const ACTION_TONE: Record<string, string> = {
  whatsapp_template: 'bg-success-bg text-success-text',
  email: 'bg-brand-tint text-brand-text',
  webhook: 'bg-chip-bg text-chip-text',
}

type ActionType = 'whatsapp_template' | 'email' | 'webhook'
interface WhatsAppVariable { source: string; text: string }
interface ActionForm {
  action_type: ActionType
  template_name: string
  template_language: string
  doc_template_id: string
  variables: WhatsAppVariable[]
  subject: string
  body: string
  url: string
  secret: string
}
function blankAction(): ActionForm {
  return { action_type: 'whatsapp_template', template_name: '', template_language: 'es', doc_template_id: '', variables: [{ source: 'first_name', text: '' }], subject: '', body: '', url: '', secret: '' }
}

interface WhatsAppTemplate { name: string; language: string; variableCount: number }
const whatsappTemplates = ref<WhatsAppTemplate[]>([])
const templatesError = ref('')
function templateKey(t: Pick<WhatsAppTemplate, 'name' | 'language'>) {
  return `${t.name}::${t.language}`
}

const savedRuleId = ref<string | null>(props.ruleId ?? null)
const name = ref('Campaign')
const triggerEvent = ref(TRIGGER_OPTIONS[0].value)
const enabled = ref(true)
// Marketing rules only reach patients who've opted that channel in via
// marketing_channels (see server/utils/runAutomationActions.ts) -- off by
// default since the built-in triggers are transactional (tied to a specific
// appointment/invoice), except patient.birthday which isn't tied to any
// transaction and is close to always promotional in practice.
const isMarketing = ref(false)
const actions = ref<ActionForm[]>([blankAction()])
const docTemplates = ref<{ id: string; title: string }[]>([])
const appointmentTypes = ref<{ id: string; name: string }[]>([])
const filterAppointmentTypeId = ref('')
const filterTotalVisits = ref('')
// no_prior_appointments/has_future_appointment aren't editable in this UI
// (only the two migrated birthday/first-booking rules use them) -- carried
// through untouched on save so editing a rule here doesn't silently drop them.
let otherFilters: Record<string, unknown> = {}
const loading = ref(!!props.ruleId)
const saving = ref(false)
const testing = ref(false)
const testMessage = ref('')
const error = ref('')

onMounted(async () => {
  const { data: templates } = await supabase.from('doc_templates').select('id, title').order('title')
  docTemplates.value = templates ?? []

  const { data: types } = await supabase.from('appointment_types').select('id, name').order('name')
  appointmentTypes.value = types ?? []

  try {
    const { templates: waList } = await useStaffFetch<{ templates: WhatsAppTemplate[] }>('/api/whatsapp/templates')
    whatsappTemplates.value = waList
  } catch (err: any) {
    templatesError.value = err?.data?.statusMessage ?? 'Failed to load WhatsApp templates'
  }

  if (props.ruleId) {
    const [{ data: rule }, { data: existingActions }] = await Promise.all([
      supabase.from('automation_rules').select('name, trigger_event, enabled, filters, is_marketing').eq('id', props.ruleId).maybeSingle(),
      supabase.from('automation_actions').select('action_type, config').eq('rule_id', props.ruleId).order('position'),
    ])
    if (rule) {
      name.value = rule.name
      triggerEvent.value = rule.trigger_event
      enabled.value = rule.enabled
      isMarketing.value = rule.is_marketing
      const filters = (rule.filters ?? {}) as Record<string, unknown>
      filterAppointmentTypeId.value = typeof filters.appointment_type_id === 'string' ? filters.appointment_type_id : ''
      filterTotalVisits.value = typeof filters.total_visits === 'number' ? String(filters.total_visits) : ''
      const { appointment_type_id: _a, total_visits: _t, ...rest } = filters
      otherFilters = rest
    }
    if (existingActions && existingActions.length > 0) {
      actions.value = existingActions.map((a) => {
        const config = (a.config ?? {}) as Record<string, any>
        return {
          action_type: a.action_type as ActionType,
          template_name: config.template_name ?? '',
          template_language: config.template_language ?? 'es',
          doc_template_id: config.doc_template_id ?? '',
          variables: Array.isArray(config.variables) && config.variables.length > 0 ? config.variables : [{ source: 'first_name', text: '' }],
          subject: config.subject ?? '',
          body: config.body ?? '',
          url: config.url ?? '',
          secret: config.secret ?? '',
        }
      })
    }
  }
  loading.value = false
})

function addAction() {
  actions.value.push(blankAction())
}
function removeAction(index: number) {
  actions.value.splice(index, 1)
}
function templateKeyFor(a: ActionForm) {
  return whatsappTemplates.value.some((t) => templateKey(t) === `${a.template_name}::${a.template_language}`)
    ? `${a.template_name}::${a.template_language}`
    : ''
}
function selectTemplate(a: ActionForm, key: string) {
  const t = whatsappTemplates.value.find((tpl) => templateKey(tpl) === key)
  if (!t) return
  a.template_name = t.name
  a.template_language = t.language
  a.variables = Array.from({ length: t.variableCount }, () => ({ source: 'first_name', text: '' }))
}
function addVariable(a: ActionForm) {
  a.variables.push({ source: 'first_name', text: '' })
}
function removeVariable(a: ActionForm, index: number) {
  a.variables.splice(index, 1)
}

function configFor(a: ActionForm): Record<string, unknown> {
  if (a.action_type === 'whatsapp_template') {
    return {
      template_name: a.template_name.trim(),
      template_language: a.template_language.trim() || 'es',
      doc_template_id: a.doc_template_id || null,
      variables: a.variables.map((v) => ({ source: v.source, text: v.source === 'text' ? v.text.trim() : undefined })),
    }
  }
  if (a.action_type === 'email') {
    return { subject: a.subject.trim(), body: a.body }
  }
  return { url: a.url.trim(), secret: a.secret.trim() || null }
}

async function persist(): Promise<string | null> {
  error.value = ''
  if (actions.value.length === 0) {
    error.value = 'Add at least one action.'
    return null
  }

  const filters: Record<string, unknown> = { ...otherFilters }
  if (filterAppointmentTypeId.value) filters.appointment_type_id = filterAppointmentTypeId.value
  if (filterTotalVisits.value !== '') filters.total_visits = Number(filterTotalVisits.value)

  const rulePayload = {
    account_id: store.accountId!,
    name: name.value.trim() || 'Campaign',
    trigger_event: triggerEvent.value,
    enabled: enabled.value,
    filters: filters as any,
    is_marketing: isMarketing.value,
  }

  const ruleResult = savedRuleId.value
    ? await supabase.from('automation_rules').update(rulePayload).eq('id', savedRuleId.value).select('id').single()
    : await supabase.from('automation_rules').insert({ ...rulePayload, created_by: store.teamMember?.id ?? null }).select('id').single()

  if (ruleResult.error || !ruleResult.data) {
    error.value = ruleResult.error?.message ?? 'Failed to save.'
    return null
  }
  const ruleId = ruleResult.data.id
  savedRuleId.value = ruleId

  // Replace the action rows wholesale rather than diffing inserts/updates/
  // deletes -- simplest correct way to keep them in sync with the form.
  await supabase.from('automation_actions').delete().eq('rule_id', ruleId)
  await supabase.from('automation_actions').insert(
    actions.value.map((a, i) => ({
      account_id: store.accountId!,
      rule_id: ruleId,
      action_type: a.action_type,
      position: i,
      config: configFor(a),
    })),
  )

  return ruleId
}

async function save() {
  saving.value = true
  const ruleId = await persist()
  saving.value = false
  if (ruleId) emit('saved')
}

async function sendTestToMe() {
  if (actions.value.length === 0) {
    error.value = 'Add at least one action.'
    return
  }
  testing.value = true
  testMessage.value = ''
  try {
    // Sends the draft as it stands right now -- deliberately not persisted
    // first, so previewing a campaign never has the side effect of writing a
    // real (enabled) automation_rules row before the user has chosen to save.
    const result = await useStaffFetch<{ sent: boolean; email: string }>('/api/automations/send-test', {
      method: 'POST',
      body: { actions: actions.value.map((a) => ({ action_type: a.action_type, config: configFor(a) })) },
    })
    testMessage.value = `Sent to ${result.email}`
  } catch {
    testMessage.value = 'Failed to send test.'
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-30 flex justify-end bg-[rgba(20,22,30,.32)]" @click.self="emit('close')">
    <div class="flex h-full w-[560px] flex-col bg-surface shadow-drawer">
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <h2 class="text-[15px] font-semibold text-ink-900">{{ savedRuleId ? 'Edit campaign' : 'New campaign' }}</h2>
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint2 hover:bg-surface-subtle hover:text-ink-muted" @click="emit('close')">✕</button>
      </div>

      <div v-if="loading" class="flex-1 p-6 text-[13px] text-ink-faint">Loading…</div>
      <form v-else class="flex flex-1 flex-col overflow-hidden" @submit.prevent="save">
        <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label class="block text-[12.5px] font-medium text-ink-700">Name</label>
            <input
              v-model="name"
              type="text"
              class="mt-1.5 h-9 w-full rounded-ctl border border-line-control px-3 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <label class="flex items-center justify-between rounded-card border border-line px-3.5 py-2.5">
            <span class="text-[12.5px] font-medium text-ink-700">Enabled</span>
            <button
              type="button"
              role="switch"
              :aria-checked="enabled"
              class="relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full transition-colors"
              :class="enabled ? 'bg-brand' : 'bg-toggle-off'"
              @click="enabled = !enabled"
            >
              <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform" :class="enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'" />
            </button>
          </label>

          <div class="rounded-card border border-line px-3.5 py-2.5">
            <label class="flex items-center justify-between">
              <span class="text-[12.5px] font-medium text-ink-700">Marketing message</span>
              <button
                type="button"
                role="switch"
                :aria-checked="isMarketing"
                class="relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full transition-colors"
                :class="isMarketing ? 'bg-brand' : 'bg-toggle-off'"
                @click="isMarketing = !isMarketing"
              >
                <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform" :class="isMarketing ? 'translate-x-[16px]' : 'translate-x-[2px]'" />
              </button>
            </label>
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted2">
              Only sends to patients who've opted that channel in under Marketing channels on their profile. Turn this on for promotional content
              (offers, birthday greetings) -- leave it off for transactional messages tied to a specific appointment or invoice, which don't need
              separate marketing consent.
              <template v-if="triggerEvent === 'patient.birthday' && !isMarketing"> Birthday campaigns are usually marketing.</template>
            </p>
          </div>

          <div class="rounded-card border border-[#EDEEF2] bg-surface-subtle p-3.5">
            <label class="block text-[12.5px] font-medium text-ink-700">When this happens</label>
            <select
              v-model="triggerEvent"
              class="mt-1.5 h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option v-for="t in TRIGGER_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted2">Or leave this and use "Send now" from the campaign list to make this a one-off send only.</p>
          </div>

          <div v-if="!NO_APPOINTMENT_CONTEXT_TRIGGERS.includes(triggerEvent)" class="rounded-card border border-[#EDEEF2] bg-surface-subtle p-3.5">
            <label class="block text-[12.5px] font-medium text-ink-700">Only when</label>
            <div class="mt-1.5 grid grid-cols-2 gap-2.5">
              <select
                v-model="filterAppointmentTypeId"
                class="h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="">Any appointment type</option>
                <option v-for="t in appointmentTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
              <input
                v-model="filterTotalVisits"
                type="number"
                min="0"
                placeholder="Any visit count"
                class="h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted2">
              Visit count is the patient's total completed visits of that type (e.g. 1 = the first time it's ever completed for them, 0 = never completed).
            </p>
          </div>

          <div class="border-t border-line-divider pt-4">
            <div class="flex items-center justify-between">
              <h3 class="text-[12.5px] font-medium text-ink-700">Then do this</h3>
              <UiBtn variant="ghost" size="sm" type="button" @click="addAction">+ Add action</UiBtn>
            </div>

            <div class="mt-2.5 space-y-3">
              <div v-for="(a, i) in actions" :key="i" class="rounded-card border border-line p-3.5">
                <div class="flex items-center justify-between gap-2">
                  <select
                    v-model="a.action_type"
                    class="appearance-none rounded-pill border-0 px-3 py-1 text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-brand"
                    :class="ACTION_TONE[a.action_type]"
                  >
                    <option value="whatsapp_template">WhatsApp template</option>
                    <option value="email">Email</option>
                    <option value="webhook">Webhook</option>
                  </select>
                  <button v-if="actions.length > 1" type="button" class="text-[12px] font-medium text-danger-text hover:underline" @click="removeAction(i)">Remove</button>
                </div>

                <div v-if="a.action_type === 'whatsapp_template'" class="mt-3 space-y-2.5">
                  <p v-if="templatesError" class="text-[12px] text-danger-text">{{ templatesError }}</p>
                  <select
                    v-else
                    :value="templateKeyFor(a)"
                    class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    @change="selectTemplate(a, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="" disabled>{{ whatsappTemplates.length === 0 ? 'No approved templates found' : 'Choose a template…' }}</option>
                    <option v-for="t in whatsappTemplates" :key="templateKey(t)" :value="templateKey(t)">{{ t.name }} ({{ t.language }})</option>
                  </select>
                  <p v-if="a.template_name && !templateKeyFor(a) && !templatesError" class="text-[11.5px] text-warning-text">
                    Currently set to "{{ a.template_name }}" ({{ a.template_language }}), which isn't in the approved template list anymore.
                  </p>
                  <div>
                    <select
                      v-model="a.doc_template_id"
                      class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      <option value="">No document</option>
                      <option v-for="t in docTemplates" :key="t.id" :value="t.id">{{ t.title }}</option>
                    </select>
                    <p class="mt-1 text-[11px] text-ink-muted2">Only one document can be attached per template send, matching WhatsApp's own template format.</p>
                  </div>
                  <div>
                    <p class="text-[11.5px] font-medium text-ink-muted2">Template variables, in order (match however many numbered placeholders your template has)</p>
                    <div v-for="(v, vi) in a.variables" :key="vi" class="mt-1.5 flex items-center gap-2">
                      <span class="w-4 shrink-0 text-[11.5px] text-ink-faint">{{ vi + 1 }}.</span>
                      <select
                        v-model="v.source"
                        class="h-7 rounded-ctlSm border border-line-control px-2 text-[12px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      >
                        <option v-for="s in VARIABLE_SOURCES" :key="s.value" :value="s.value">{{ s.label }}</option>
                      </select>
                      <input
                        v-if="v.source === 'text'"
                        v-model="v.text"
                        type="text"
                        placeholder="Fixed value"
                        class="h-7 flex-1 rounded-ctlSm border border-line-control px-2 text-[12px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                      <button v-if="a.variables.length > 1" type="button" class="shrink-0 text-[12px] text-danger-text hover:underline" @click="removeVariable(a, vi)">✕</button>
                    </div>
                    <button type="button" class="mt-1.5 text-[12px] font-medium text-brand-text hover:text-brand-hover" @click="addVariable(a)">+ Add variable</button>
                    <p v-if="a.doc_template_id" class="mt-1 text-[11px] text-ink-muted2">The document link is sent as the last variable, after these.</p>
                  </div>
                </div>

                <div v-else-if="a.action_type === 'email'" class="mt-3 space-y-2.5">
                  <input
                    v-model="a.subject"
                    type="text"
                    placeholder="Subject — {{first_name}} works here too"
                    class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <CampaignsRichTextEditor v-model="a.body" />
                </div>

                <div v-else class="mt-3 space-y-2.5">
                  <input
                    v-model="a.url"
                    type="url"
                    placeholder="https://example.com/hook"
                    class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <input
                    v-model="a.secret"
                    type="text"
                    placeholder="Signing secret (optional)"
                    class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
              </div>
            </div>
          </div>

          <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
        </div>

        <div class="flex shrink-0 items-center justify-between border-t border-line-divider bg-surface-subtle2 px-6 py-3.5">
          <div class="flex items-center gap-2.5">
            <UiBtn variant="ghost" size="sm" type="button" :disabled="testing" @click="sendTestToMe">{{ testing ? 'Sending…' : 'Send test to me' }}</UiBtn>
            <p v-if="testMessage" class="text-[12px]" :class="testMessage.startsWith('Failed') ? 'text-danger-text' : 'text-success-text'">{{ testMessage }}</p>
          </div>
          <div class="flex items-center gap-2">
            <UiBtn variant="secondary" type="button" @click="emit('close')">Cancel</UiBtn>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save campaign' }}</UiBtn>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
