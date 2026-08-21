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
  { value: 'appointment.no_show', label: 'Appointment marked as missed' },
  { value: 'invoice.paid', label: 'Invoice paid' },
]
const VARIABLE_SOURCES = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'text', label: 'Fixed text' },
]

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

const name = ref('Campaign')
const triggerEvent = ref(TRIGGER_OPTIONS[0].value)
const enabled = ref(true)
const actions = ref<ActionForm[]>([blankAction()])
const docTemplates = ref<{ id: string; title: string }[]>([])
const loading = ref(!!props.ruleId)
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  const { data: templates } = await supabase.from('doc_templates').select('id, title').order('title')
  docTemplates.value = templates ?? []

  if (props.ruleId) {
    const [{ data: rule }, { data: existingActions }] = await Promise.all([
      supabase.from('automation_rules').select('name, trigger_event, enabled').eq('id', props.ruleId).maybeSingle(),
      supabase.from('automation_actions').select('action_type, config').eq('rule_id', props.ruleId).order('position'),
    ])
    if (rule) {
      name.value = rule.name
      triggerEvent.value = rule.trigger_event
      enabled.value = rule.enabled
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

async function save() {
  error.value = ''
  if (actions.value.length === 0) {
    error.value = 'Add at least one action.'
    return
  }
  saving.value = true

  const rulePayload = { account_id: store.accountId!, name: name.value.trim() || 'Campaign', trigger_event: triggerEvent.value, enabled: enabled.value }

  const ruleResult = props.ruleId
    ? await supabase.from('automation_rules').update(rulePayload).eq('id', props.ruleId).select('id').single()
    : await supabase.from('automation_rules').insert({ ...rulePayload, created_by: store.teamMember?.id ?? null }).select('id').single()

  if (ruleResult.error || !ruleResult.data) {
    saving.value = false
    error.value = ruleResult.error?.message ?? 'Failed to save.'
    return
  }
  const ruleId = ruleResult.data.id

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

  saving.value = false
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900">{{ ruleId ? 'Edit Campaign' : 'New Campaign' }}</h2>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>

      <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
      <form v-else class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label class="block text-sm font-medium text-gray-700">Name</label>
          <input v-model="name" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700">When this happens</label>
          <select v-model="triggerEvent" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option v-for="t in TRIGGER_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <p class="mt-1 text-xs text-gray-500">Or skip this and use "Send Now" from the campaign list for a one-off send instead.</p>
        </div>

        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input v-model="enabled" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
          Enabled
        </label>

        <div class="border-t border-gray-100 pt-4">
          <div class="flex items-center justify-between">
            <label class="block text-sm font-medium text-gray-700">Do this</label>
            <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="addAction">+ Add action</button>
          </div>

          <div class="mt-2 space-y-3">
            <div v-for="(a, i) in actions" :key="i" class="rounded-md border border-gray-200 p-3">
              <div class="flex items-center justify-between gap-2">
                <select v-model="a.action_type" class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                  <option value="whatsapp_template">Send WhatsApp template</option>
                  <option value="email">Send email</option>
                  <option value="webhook">Call a webhook</option>
                </select>
                <button v-if="actions.length > 1" type="button" class="text-xs text-red-600 hover:text-red-700" @click="removeAction(i)">Remove</button>
              </div>

              <div v-if="a.action_type === 'whatsapp_template'" class="mt-3 space-y-2">
                <div class="flex gap-2">
                  <input v-model="a.template_name" type="text" placeholder="template_name" class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  <input v-model="a.template_language" type="text" placeholder="es" class="w-16 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <select v-model="a.doc_template_id" class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                    <option value="">No document</option>
                    <option v-for="t in docTemplates" :key="t.id" :value="t.id">{{ t.title }}</option>
                  </select>
                  <p class="mt-1 text-xs text-gray-500">Only one document can be attached per template send, matching WhatsApp's own template format.</p>
                </div>
                <div>
                  <p class="text-xs font-medium text-gray-600">Template variables, in order (match however many numbered placeholders your template has)</p>
                  <div v-for="(v, vi) in a.variables" :key="vi" class="mt-1 flex items-center gap-2">
                    <span class="w-4 shrink-0 text-xs text-gray-400">{{ vi + 1 }}.</span>
                    <select v-model="v.source" class="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      <option v-for="s in VARIABLE_SOURCES" :key="s.value" :value="s.value">{{ s.label }}</option>
                    </select>
                    <input v-if="v.source === 'text'" v-model="v.text" type="text" placeholder="Fixed value" class="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                    <button v-if="a.variables.length > 1" type="button" class="shrink-0 text-xs text-red-600 hover:text-red-700" @click="removeVariable(a, vi)">✕</button>
                  </div>
                  <button type="button" class="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="addVariable(a)">+ Add variable</button>
                  <p v-if="a.doc_template_id" class="mt-1 text-xs text-gray-500">The document link is sent as the last variable, after these.</p>
                </div>
              </div>

              <div v-else-if="a.action_type === 'email'" class="mt-3 space-y-2">
                <input v-model="a.subject" type="text" placeholder="Subject — {{first_name}} works here too" class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <CampaignsRichTextEditor v-model="a.body" />
              </div>

              <div v-else class="mt-3 space-y-2">
                <input v-model="a.url" type="url" placeholder="https://example.com/hook" class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <input v-model="a.secret" type="text" placeholder="Signing secret (optional)" class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
            </div>
          </div>
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button type="button" class="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" @click="emit('close')">Cancel</button>
          <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
