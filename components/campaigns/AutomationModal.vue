<script setup lang="ts">
import type { Json } from '~/types/database.types'

const props = defineProps<{ ruleId?: string | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const TRIGGER_OPTIONS = computed(() => [
  { value: 'appointment.checked_in', label: t('Patient checked in', 'Paciente registrado') },
  { value: 'appointment.booked', label: t('Appointment booked', 'Cita reservada') },
  { value: 'appointment.completed', label: t('Appointment completed', 'Cita completada') },
  { value: 'appointment.cancelled', label: t('Appointment cancelled', 'Cita cancelada') },
  { value: 'appointment.rescheduled', label: t('Appointment rescheduled', 'Cita reprogramada') },
  { value: 'appointment.no_show', label: t('Appointment marked as missed', 'Cita marcada como no asistida') },
  { value: 'appointment.same_day', label: t('Day of appointment (morning send)', 'Día de la cita (envío por la mañana)') },
  { value: 'appointment.hours_before', label: t('X hours before appointment', 'X horas antes de la cita') },
  { value: 'appointment.review_request', label: t('X days after a completed visit (review request)', 'X días después de una visita completada (solicitud de reseña)') },
  { value: 'invoice.paid', label: t('Invoice paid', 'Factura pagada') },
  { value: 'patient.birthday', label: t("Patient's birthday (daily check)", 'Cumpleaños del paciente (comprobación diaria)') },
  { value: 'patient.referred', label: t('Patient referred someone (thank the referrer)', 'El paciente refirió a alguien (agradecer a quien refirió)') },
  { value: 'membership.new_member', label: t('New membership started', 'Nueva membresía iniciada') },
  { value: 'membership.removed', label: t('Membership cancelled', 'Membresía cancelada') },
  { value: 'membership.payment_processed', label: t('Membership payment processed', 'Pago de membresía procesado') },
  { value: 'waitlist.slot_offered', label: t('Waitlist slot offered', 'Plaza de lista de espera ofrecida') },
])
// These fire with no appointment in scope, same as patient.birthday --
// the appointment-type/visit-count filter block below doesn't apply.
// patient.referred fires for the referring patient, not tied to any one of
// their appointments, so it belongs here too. waitlist.slot_offered fires
// before the offered slot is a real appointment (claiming is what creates
// it), so it has no appointment row to filter on either.
const NO_APPOINTMENT_CONTEXT_TRIGGERS = ['patient.birthday', 'patient.referred', 'waitlist.slot_offered', 'membership.new_member', 'membership.removed', 'membership.payment_processed']
const VARIABLE_SOURCES = computed(() => [
  { value: 'first_name', label: t('First name', 'Nombre') },
  { value: 'last_name', label: t('Last name', 'Apellidos') },
  { value: 'email', label: t('Email', 'Correo electrónico') },
  { value: 'next_appointment', label: t('Appointment date & time', 'Fecha y hora de la cita') },
  { value: 'appointment_date', label: t('Appointment date', 'Fecha de la cita') },
  { value: 'appointment_time', label: t('Appointment time', 'Hora de la cita') },
  { value: 'google_review_link', label: t('Google review link', 'Enlace de reseña de Google') },
  { value: 'waitlist_claim_link', label: t('Waitlist claim link', 'Enlace para reservar plaza') },
  { value: 'waitlist_slot_datetime', label: t('Waitlist offered slot date & time', 'Fecha y hora de la plaza ofrecida') },
  { value: 'text', label: t('Fixed text', 'Texto fijo') },
])
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
  doc_template_ids: string[]
  variables: WhatsAppVariable[]
  subject: string
  body: string
  url: string
  secret: string
}
function blankAction(): ActionForm {
  return { action_type: 'whatsapp_template', template_name: '', template_language: 'es', doc_template_ids: [], variables: [{ source: 'first_name', text: '' }], subject: '', body: '', url: '', secret: '' }
}

interface WhatsAppTemplate { name: string; language: string; variableCount: number; urlButtonCount: number }
const whatsappTemplates = ref<WhatsAppTemplate[]>([])
const templatesError = ref('')
function templateKey(t: Pick<WhatsAppTemplate, 'name' | 'language'>) {
  return `${t.name}::${t.language}`
}

const savedRuleId = ref<string | null>(props.ruleId ?? null)
const name = ref(t('Campaign', 'Campaña'))
const triggerEvent = ref(TRIGGER_OPTIONS.value[0].value)
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
const practitioners = ref<{ id: string; full_name: string }[]>([])
const membershipPlans = ref<{ id: string; name: string }[]>([])
// Any of these types matches (OR) -- an appointment only ever has one type,
// so e.g. "Primera visita" or "Oferta primera visita" both firing this rule
// means picking both here, not a way to require both at once (AND).
const filterAppointmentTypeIds = ref<string[]>([])
const filterTotalVisits = ref('')
const filterNoPriorAppointments = ref(false)

// Extra, addable "Only when" conditions beyond the always-shown appointment
// type/visit-count block above -- each block is a different field (AND
// across blocks; a field can only be added once, so there's no need to
// support multiple blocks of the same field). Field-specific value slots all
// live on the one object rather than a discriminated union so the template
// can v-model them directly regardless of which field is picked.
type ConditionField = 'practitioner' | 'tag' | 'balance' | 'membership'
interface ExtraCondition {
  field: ConditionField
  practitionerIds: string[]
  tagContains: string
  balance: 'debit' | 'credit'
  membershipIds: string[]
}
function blankCondition(field: ConditionField): ExtraCondition {
  return { field, practitionerIds: [], tagContains: '', balance: 'debit', membershipIds: [] }
}
const CONDITION_FIELD_LABELS: Record<ConditionField, () => string> = {
  practitioner: () => t('Practitioner', 'Profesional'),
  tag: () => t('Patient tag', 'Etiqueta de paciente'),
  balance: () => t('Account balance', 'Saldo de cuenta'),
  membership: () => t('Membership', 'Membresía'),
}
const extraConditions = ref<ExtraCondition[]>([])
const availableConditionFields = computed<ConditionField[]>(() => {
  const used = new Set(extraConditions.value.map((c) => c.field))
  return (['practitioner', 'tag', 'balance', 'membership'] as ConditionField[]).filter((f) => !used.has(f))
})
function addCondition() {
  const next = availableConditionFields.value[0]
  if (next) extraConditions.value.push(blankCondition(next))
}
function removeCondition(index: number) {
  extraConditions.value.splice(index, 1)
}
// Only meaningful for the appointment.hours_before trigger -- how long
// before the appointment's start time this rule fires (e.g. 24 for a
// day-before reminder, 72 for three days before). A clinic wanting both
// just creates two rules on this same trigger with different values.
const filterHoursBefore = ref('24')
// Only meaningful for appointment.review_request -- how many days after the
// visit ends this rule fires. Same multi-rule pattern as hours_before.
const filterDaysAfter = ref('2')
// has_future_appointment isn't editable in this UI (only the birthday rule
// uses it) -- carried through untouched on save so editing a rule here
// doesn't silently drop it.
let otherFilters: Record<string, unknown> = {}
const loading = ref(!!props.ruleId)
const saving = ref(false)
const testing = ref(false)
const testMessage = ref('')
const testMessageIsError = ref(false)
const testWhatsAppNumber = ref('')
const error = ref('')

onMounted(async () => {
  const { data: templates } = await supabase.from('doc_templates').select('id, title').order('title')
  docTemplates.value = templates ?? []

  const { data: types } = await supabase.from('appointment_types').select('id, name').order('name')
  appointmentTypes.value = types ?? []

  const { data: teamMembers } = await supabase.from('team_members').select('id, full_name').eq('is_practitioner', true).is('deleted_at', null).order('full_name')
  practitioners.value = teamMembers ?? []

  const { data: plans } = await supabase.from('memberships').select('id, name').order('name')
  membershipPlans.value = plans ?? []

  try {
    const { templates: waList } = await useStaffFetch<{ templates: WhatsAppTemplate[] }>('/api/whatsapp/templates')
    whatsappTemplates.value = waList
  } catch (err: any) {
    templatesError.value = err?.data?.statusMessage ?? t('Failed to load WhatsApp templates', 'No se han podido cargar las plantillas de WhatsApp')
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
      // appointment_type_id (singular) is what rules saved before multi-select
      // existed still have on disk -- read it as a one-item array so an old
      // rule shows up with its type still checked instead of silently reset.
      filterAppointmentTypeIds.value = Array.isArray(filters.appointment_type_ids)
        ? filters.appointment_type_ids.filter((id): id is string => typeof id === 'string')
        : typeof filters.appointment_type_id === 'string'
          ? [filters.appointment_type_id]
          : []
      filterTotalVisits.value = typeof filters.total_visits === 'number' ? String(filters.total_visits) : ''
      filterNoPriorAppointments.value = filters.no_prior_appointments === true
      filterHoursBefore.value = typeof filters.hours_before === 'number' ? String(filters.hours_before) : '24'
      filterDaysAfter.value = typeof filters.days_after === 'number' ? String(filters.days_after) : '2'

      const conditions: ExtraCondition[] = []
      if (Array.isArray(filters.practitioner_ids) && filters.practitioner_ids.length > 0) {
        conditions.push({ ...blankCondition('practitioner'), practitionerIds: filters.practitioner_ids.filter((id): id is string => typeof id === 'string') })
      }
      if (typeof filters.tag_contains === 'string' && filters.tag_contains) {
        conditions.push({ ...blankCondition('tag'), tagContains: filters.tag_contains })
      }
      if (filters.balance === 'debit' || filters.balance === 'credit') {
        conditions.push({ ...blankCondition('balance'), balance: filters.balance })
      }
      if (filters.membership_active === true || (Array.isArray(filters.membership_ids) && filters.membership_ids.length > 0)) {
        conditions.push({
          ...blankCondition('membership'),
          membershipIds: Array.isArray(filters.membership_ids) ? filters.membership_ids.filter((id): id is string => typeof id === 'string') : [],
        })
      }
      extraConditions.value = conditions

      const {
        appointment_type_id: _a,
        appointment_type_ids: _ai,
        total_visits: _t,
        no_prior_appointments: _n,
        hours_before: _h,
        days_after: _d,
        practitioner_ids: _p,
        tag_contains: _tc,
        balance: _b,
        membership_active: _ma,
        membership_ids: _mi,
        ...rest
      } = filters
      otherFilters = rest
    }
    if (existingActions && existingActions.length > 0) {
      actions.value = existingActions.map((a) => {
        const config = (a.config ?? {}) as Record<string, any>
        return {
          action_type: a.action_type as ActionType,
          template_name: config.template_name ?? '',
          template_language: config.template_language ?? 'es',
          doc_template_ids: Array.isArray(config.doc_template_ids) ? config.doc_template_ids : [],
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
  // One doc slot per dynamic URL button on the template, or a single slot
  // (appended to the body instead) for a template with none.
  a.doc_template_ids = Array.from({ length: Math.max(t.urlButtonCount, 1) }, () => '')
}
// How many doc-link pickers to show for this action: matches the selected
// template's dynamic URL button count when known, otherwise falls back to
// whatever's already configured so an unrecognized/renamed template doesn't
// lose its saved picks.
function docSlotCountFor(a: ActionForm) {
  const t = whatsappTemplates.value.find((tpl) => templateKey(tpl) === templateKeyFor(a))
  return t ? Math.max(t.urlButtonCount, 1) : Math.max(a.doc_template_ids.length, 1)
}
function whatsappTemplateFor(a: ActionForm) {
  return whatsappTemplates.value.find((tpl) => templateKey(tpl) === templateKeyFor(a))
}
function docSlotLabel(a: ActionForm, index: number) {
  return (whatsappTemplateFor(a)?.urlButtonCount ?? 0) > 0 ? t(`Button ${index + 1} document`, `Documento del botón ${index + 1}`) : t('Document', 'Documento')
}
// True when the configured doc (slot 0 only) is sent as a body variable
// instead of a button parameter -- i.e. the template has no dynamic URL
// button to attach it to.
function isBodyDocSlot(a: ActionForm) {
  return (whatsappTemplateFor(a)?.urlButtonCount ?? 0) === 0
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
      doc_template_ids: a.doc_template_ids.map((id) => id || null),
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
    error.value = t('Add at least one action.', 'Añade al menos una acción.')
    return null
  }

  const filters: Record<string, unknown> = { ...otherFilters }
  if (filterAppointmentTypeIds.value.length > 0) filters.appointment_type_ids = filterAppointmentTypeIds.value
  if (filterTotalVisits.value !== '') filters.total_visits = Number(filterTotalVisits.value)
  if (filterNoPriorAppointments.value) filters.no_prior_appointments = true
  for (const c of extraConditions.value) {
    if (c.field === 'practitioner' && c.practitionerIds.length > 0) filters.practitioner_ids = c.practitionerIds
    if (c.field === 'tag' && c.tagContains.trim()) filters.tag_contains = c.tagContains.trim()
    if (c.field === 'balance') filters.balance = c.balance
    if (c.field === 'membership') {
      filters.membership_active = true
      if (c.membershipIds.length > 0) filters.membership_ids = c.membershipIds
    }
  }
  if (triggerEvent.value === 'appointment.hours_before') {
    filters.hours_before = Math.max(1, Math.round(Number(filterHoursBefore.value) || 24))
  }
  if (triggerEvent.value === 'appointment.review_request') {
    filters.days_after = Math.max(1, Math.round(Number(filterDaysAfter.value) || 2))
  }

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
    error.value = ruleResult.error?.message ?? t('Failed to save.', 'No se ha podido guardar.')
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
      config: configFor(a) as Json,
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

const hasWhatsAppAction = computed(() => actions.value.some((a) => a.action_type === 'whatsapp_template'))
// A test send impersonates the signed-in team member, not a real patient --
// document links need a real patients row (patient_docs.patient_id has a
// hard FK to it), so any document button/variable here will silently fail
// to generate and fall back to a broken placeholder. Only "Send now" against
// a real patient (from the campaign list) can actually verify one.
const hasDocAttached = computed(() => actions.value.some((a) => a.action_type === 'whatsapp_template' && a.doc_template_ids.some(Boolean)))

async function sendTestToMe() {
  if (actions.value.length === 0) {
    error.value = t('Add at least one action.', 'Añade al menos una acción.')
    return
  }
  if (hasWhatsAppAction.value && !testWhatsAppNumber.value.trim()) {
    testMessage.value = t('Enter a WhatsApp number to test with.', 'Introduce un número de WhatsApp para probar.')
    testMessageIsError.value = true
    return
  }
  testing.value = true
  testMessage.value = ''
  try {
    // Sends the draft as it stands right now -- deliberately not persisted
    // first, so previewing a campaign never has the side effect of writing a
    // real (enabled) automation_rules row before the user has chosen to save.
    const result = await useStaffFetch<{ sent: boolean; email: string | null; whatsappNumber: string | null }>('/api/automations/send-test', {
      method: 'POST',
      body: {
        actions: actions.value.map((a) => ({ action_type: a.action_type, config: configFor(a) })),
        whatsappNumber: hasWhatsAppAction.value ? testWhatsAppNumber.value : undefined,
      },
    })
    const parts: string[] = []
    if (result.whatsappNumber) parts.push(`${t('WhatsApp to', 'WhatsApp a')} +${result.whatsappNumber}`)
    if (result.email) parts.push(`${t('email to', 'correo a')} ${result.email}`)
    testMessage.value = parts.length > 0 ? `${t('Sent', 'Enviado')}: ${parts.join(', ')}` : t('Nothing to send.', 'Nada que enviar.')
    testMessageIsError.value = false
  } catch {
    testMessage.value = t('Failed to send test.', 'No se ha podido enviar la prueba.')
    testMessageIsError.value = true
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-30 flex justify-end bg-ink-900/40" @click.self="emit('close')">
    <div class="flex h-full w-[560px] flex-col bg-surface shadow-drawer">
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <h2 class="text-[15px] font-semibold text-ink-900">{{ savedRuleId ? t('Edit campaign', 'Editar campaña') : t('New campaign', 'Nueva campaña') }}</h2>
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint2 hover:bg-surface-subtle hover:text-ink-muted" @click="emit('close')">✕</button>
      </div>

      <div v-if="loading" class="flex-1 p-6 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
      <form v-else class="flex flex-1 flex-col overflow-hidden" @submit.prevent="save">
        <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Name', 'Nombre') }}</label>
            <input
              v-model="name"
              type="text"
              class="mt-1.5 h-9 w-full rounded-ctl border border-line-control px-3 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <label class="flex items-center justify-between rounded-card border border-line px-3.5 py-2.5">
            <span class="text-[12.5px] font-medium text-ink-700">{{ t('Enabled', 'Activado') }}</span>
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
              <span class="text-[12.5px] font-medium text-ink-700">{{ t('Marketing message', 'Mensaje de marketing') }}</span>
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
              {{ t(
                "Only sends to patients who've opted that channel in under Marketing channels on their profile. Turn this on for promotional content (offers, birthday greetings) -- leave it off for transactional messages tied to a specific appointment or invoice, which don't need separate marketing consent.",
                'Solo se envía a pacientes que hayan activado ese canal en Canales de marketing en su perfil. Actívalo para contenido promocional (ofertas, felicitaciones de cumpleaños) -- desactívalo para mensajes transaccionales ligados a una cita o factura concreta, que no necesitan consentimiento de marketing por separado.',
              ) }}
              <template v-if="triggerEvent === 'patient.birthday' && !isMarketing"> {{ t('Birthday campaigns are usually marketing.', 'Las campañas de cumpleaños suelen ser de marketing.') }}</template>
            </p>
          </div>

          <div class="rounded-card border border-[#EDEEF2] bg-surface-subtle p-3.5">
            <label class="block text-[12.5px] font-medium text-ink-700">{{ t('When this happens', 'Cuando esto ocurre') }}</label>
            <select
              v-model="triggerEvent"
              class="mt-1.5 h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option v-for="opt in TRIGGER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted2">{{ t('Or leave this and use "Send now" from the campaign list to make this a one-off send only.', 'O deja esto y usa "Enviar ahora" desde la lista de campañas para hacer un envío único.') }}</p>
          </div>

          <div v-if="triggerEvent === 'appointment.hours_before'" class="rounded-card border border-[#EDEEF2] bg-surface-subtle p-3.5">
            <label class="block text-[12.5px] font-medium text-ink-700">Send this many hours before the appointment</label>
            <input
              v-model="filterHoursBefore"
              type="number"
              min="1"
              placeholder="e.g. 24"
              class="mt-1.5 h-9 w-32 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted2">
              For a second reminder at a different point (e.g. 3 days before as well as 24 hours before), create another campaign on this same trigger with a different value here.
            </p>
          </div>

          <div v-if="triggerEvent === 'appointment.review_request'" class="rounded-card border border-[#EDEEF2] bg-surface-subtle p-3.5">
            <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Send this many days after the visit', 'Enviar este número de días después de la visita') }}</label>
            <input
              v-model="filterDaysAfter"
              type="number"
              min="1"
              placeholder="e.g. 2"
              class="mt-1.5 h-9 w-32 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted2">
              {{ t('Use the Google review link variable/merge field in the message below to link straight to your review page — set it under Settings → Communications → General.', 'Usa la variable/campo combinado del enlace de reseña de Google en el mensaje de abajo para enlazar directamente a tu página de reseñas — configúralo en Ajustes → Comunicaciones → General.') }}
            </p>
          </div>

          <div v-if="!NO_APPOINTMENT_CONTEXT_TRIGGERS.includes(triggerEvent)" class="rounded-card border border-[#EDEEF2] bg-surface-subtle p-3.5">
            <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Only when', 'Solo cuando') }}</label>
            <div class="mt-1.5 grid grid-cols-2 gap-2.5">
              <div class="rounded-ctl border border-line-control bg-surface px-3 py-1.5">
                <p class="text-[11px] text-ink-muted2">
                  {{ filterAppointmentTypeIds.length === 0 ? t('Any appointment type', 'Cualquier tipo de cita') : t('Any of these types', 'Cualquiera de estos tipos') }}
                </p>
                <div class="mt-1 flex max-h-24 flex-col gap-1 overflow-y-auto">
                  <label v-for="at in appointmentTypes" :key="at.id" class="flex items-center gap-1.5 text-[12.5px] text-ink-700">
                    <input v-model="filterAppointmentTypeIds" type="checkbox" :value="at.id" class="h-3.5 w-3.5 rounded border-line-control text-brand focus:ring-brand" />
                    {{ at.name }}
                  </label>
                </div>
              </div>
              <input
                v-model="filterTotalVisits"
                type="number"
                min="0"
                :placeholder="t('Any visit count', 'Cualquier número de visitas')"
                class="h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted2">
              {{ t("Visit count is the patient's total completed visits of that type (e.g. 1 = the first time it's ever completed for them, 0 = never completed).", 'El número de visitas es el total de visitas completadas de ese tipo por el paciente (p. ej., 1 = la primera vez que se completa para él, 0 = nunca completada).') }}
            </p>
            <label class="mt-2.5 flex items-center gap-2 text-[12.5px] text-ink-700">
              <input v-model="filterNoPriorAppointments" type="checkbox" class="h-3.5 w-3.5 rounded border-line-control text-brand focus:ring-brand" />
              {{ t('Only for first-time patients (no other appointments at all, past or future)', 'Solo para pacientes nuevos (sin ninguna otra cita, ni pasada ni futura)') }}
            </label>

            <div v-if="extraConditions.length > 0" class="mt-3 space-y-2.5 border-t border-line-divider pt-3">
              <div v-for="(c, i) in extraConditions" :key="c.field" class="rounded-ctl border border-line-control bg-surface p-2.5">
                <div class="flex items-center justify-between gap-2">
                  <select
                    v-model="c.field"
                    class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[12.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  >
                    <option :value="c.field">{{ CONDITION_FIELD_LABELS[c.field]() }}</option>
                    <option v-for="f in availableConditionFields" :key="f" :value="f">{{ CONDITION_FIELD_LABELS[f]() }}</option>
                  </select>
                  <button type="button" class="text-[12px] font-medium text-danger-text hover:underline" @click="removeCondition(i)">{{ t('Remove', 'Eliminar') }}</button>
                </div>

                <div v-if="c.field === 'practitioner'" class="mt-2 flex max-h-24 flex-col gap-1 overflow-y-auto">
                  <label v-for="p in practitioners" :key="p.id" class="flex items-center gap-1.5 text-[12.5px] text-ink-700">
                    <input v-model="c.practitionerIds" type="checkbox" :value="p.id" class="h-3.5 w-3.5 rounded border-line-control text-brand focus:ring-brand" />
                    {{ p.full_name }}
                  </label>
                  <p v-if="practitioners.length === 0" class="text-[12px] text-ink-faint">{{ t('No practitioners found.', 'No se encontraron profesionales.') }}</p>
                </div>

                <input
                  v-else-if="c.field === 'tag'"
                  v-model="c.tagContains"
                  type="text"
                  :placeholder="t('Tag contains…', 'La etiqueta contiene…')"
                  class="mt-2 h-8 w-full rounded-ctl border border-line-control px-2.5 text-[12.5px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />

                <select
                  v-else-if="c.field === 'balance'"
                  v-model="c.balance"
                  class="mt-2 h-8 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                >
                  <option value="debit">{{ t('Owing', 'Debe dinero') }}</option>
                  <option value="credit">{{ t('In credit', 'Con saldo a favor') }}</option>
                </select>

                <div v-else-if="c.field === 'membership'" class="mt-2">
                  <p class="text-[11px] text-ink-muted2">
                    {{ c.membershipIds.length === 0 ? t('Any active membership', 'Cualquier membresía activa') : t('Active in any of these plans', 'Activa en cualquiera de estos planes') }}
                  </p>
                  <div class="mt-1 flex max-h-24 flex-col gap-1 overflow-y-auto">
                    <label v-for="m in membershipPlans" :key="m.id" class="flex items-center gap-1.5 text-[12.5px] text-ink-700">
                      <input v-model="c.membershipIds" type="checkbox" :value="m.id" class="h-3.5 w-3.5 rounded border-line-control text-brand focus:ring-brand" />
                      {{ m.name }}
                    </label>
                    <p v-if="membershipPlans.length === 0" class="text-[12px] text-ink-faint">{{ t('No membership plans found.', 'No se encontraron planes de membresía.') }}</p>
                  </div>
                </div>
              </div>
            </div>

            <button
              v-if="availableConditionFields.length > 0"
              type="button"
              class="mt-2.5 text-[12.5px] font-medium text-brand-text hover:underline"
              @click="addCondition"
            >
              + {{ t('Add condition', 'Añadir condición') }}
            </button>
          </div>

          <div class="border-t border-line-divider pt-4">
            <div class="flex items-center justify-between">
              <h3 class="text-[12.5px] font-medium text-ink-700">{{ t('Then do this', 'Entonces haz esto') }}</h3>
              <UiBtn variant="ghost" size="sm" type="button" @click="addAction">+ {{ t('Add action', 'Añadir acción') }}</UiBtn>
            </div>

            <div class="mt-2.5 space-y-3">
              <div v-for="(a, i) in actions" :key="i" class="rounded-card border border-line p-3.5">
                <div class="flex items-center justify-between gap-2">
                  <select
                    v-model="a.action_type"
                    class="appearance-none rounded-pill border-0 px-3 py-1 text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-brand"
                    :class="ACTION_TONE[a.action_type]"
                  >
                    <option value="whatsapp_template">{{ t('WhatsApp template', 'Plantilla de WhatsApp') }}</option>
                    <option value="email">{{ t('Email', 'Correo electrónico') }}</option>
                    <option value="webhook">{{ t('Webhook', 'Webhook') }}</option>
                  </select>
                  <button v-if="actions.length > 1" type="button" class="text-[12px] font-medium text-danger-text hover:underline" @click="removeAction(i)">{{ t('Remove', 'Eliminar') }}</button>
                </div>

                <div v-if="a.action_type === 'whatsapp_template'" class="mt-3 space-y-2.5">
                  <p v-if="templatesError" class="text-[12px] text-danger-text">{{ templatesError }}</p>
                  <select
                    v-else
                    :value="templateKeyFor(a)"
                    class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    @change="selectTemplate(a, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="" disabled>{{ whatsappTemplates.length === 0 ? t('No approved templates found', 'No se han encontrado plantillas aprobadas') : t('Choose a template…', 'Elige una plantilla…') }}</option>
                    <option v-for="wt in whatsappTemplates" :key="templateKey(wt)" :value="templateKey(wt)">{{ wt.name }} ({{ wt.language }})</option>
                  </select>
                  <p v-if="a.template_name && !templateKeyFor(a) && !templatesError" class="text-[11.5px] text-warning-text">
                    {{ t('Currently set to', 'Actualmente configurado en') }} "{{ a.template_name }}" ({{ a.template_language }}), {{ t("which isn't in the approved template list anymore.", 'que ya no está en la lista de plantillas aprobadas.') }}
                  </p>
                  <div v-for="(_, di) in docSlotCountFor(a)" :key="di">
                    <select
                      v-model="a.doc_template_ids[di]"
                      class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      <option value="">{{ t('No document', 'Sin documento') }}</option>
                      <option v-for="dt in docTemplates" :key="dt.id" :value="dt.id">{{ dt.title }}</option>
                    </select>
                    <p class="mt-1 text-[11px] text-ink-muted2">
                      {{ docSlotLabel(a, di) }}<template v-if="isBodyDocSlot(a)"> — {{ t('sent as the last variable, after these.', 'se envía como la última variable, después de estas.') }}</template>
                    </p>
                  </div>
                  <div>
                    <p class="text-[11.5px] font-medium text-ink-muted2">{{ t('Template variables, in order (match however many numbered placeholders your template has)', 'Variables de la plantilla, en orden (coincide con el número de marcadores numerados que tenga tu plantilla)') }}</p>
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
                        :placeholder="t('Fixed value', 'Valor fijo')"
                        class="h-7 flex-1 rounded-ctlSm border border-line-control px-2 text-[12px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                      <button v-if="a.variables.length > 1" type="button" class="shrink-0 text-[12px] text-danger-text hover:underline" @click="removeVariable(a, vi)">✕</button>
                    </div>
                    <button type="button" class="mt-1.5 text-[12px] font-medium text-brand-text hover:text-brand-hover" @click="addVariable(a)">+ {{ t('Add variable', 'Añadir variable') }}</button>
                  </div>
                </div>

                <div v-else-if="a.action_type === 'email'" class="mt-3 space-y-2.5">
                  <input
                    v-model="a.subject"
                    type="text"
                    :placeholder="t('Subject — {{first_name}} works here too', 'Asunto — {{first_name}} también funciona aquí')"
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
                    :placeholder="t('Signing secret (optional)', 'Clave de firma (opcional)')"
                    class="h-8 w-full rounded-ctl border border-line-control px-2.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
              </div>
            </div>
          </div>

          <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
        </div>

        <div class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line-divider bg-surface-subtle2 px-6 py-3.5">
          <div class="flex min-w-0 flex-wrap items-center gap-2.5">
            <input
              v-if="hasWhatsAppAction"
              v-model="testWhatsAppNumber"
              type="text"
              :placeholder="t('Your WhatsApp number, e.g. +34600000000', 'Tu número de WhatsApp, p. ej. +34600000000')"
              class="h-8 w-56 shrink-0 rounded-ctl border border-line-control px-2.5 text-[12.5px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <UiBtn variant="ghost" size="sm" type="button" :disabled="testing" @click="sendTestToMe">{{ testing ? t('Sending…', 'Enviando…') : t('Send test to me', 'Enviarme una prueba') }}</UiBtn>
            <p v-if="testMessage" class="text-[12px]" :class="testMessageIsError ? 'text-danger-text' : 'text-success-text'">{{ testMessage }}</p>
            <p v-if="hasDocAttached" class="w-full text-[11px] text-ink-faint2">
              {{ t('A test send isn\'t a real patient, so document links/buttons won\'t resolve -- use "Send now" against a real patient from the campaign list to verify those.', 'Un envío de prueba no es un paciente real, así que los enlaces/botones de documentos no funcionarán -- usa "Enviar ahora" con un paciente real desde la lista de campañas para verificarlos.') }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <UiBtn variant="secondary" type="button" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Saving…', 'Guardando…') : t('Save campaign', 'Guardar campaña') }}</UiBtn>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
