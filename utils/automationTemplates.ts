// Automations to start from: the flows on the Templates board, built as trees,
// and the eight patient emails Campaigns offered (utils/campaignTemplates.ts),
// each a one-step automation as before.
//
// Everything is created PAUSED. Most flows need a WhatsApp template the clinic
// has to choose (Meta approves each clinic's own), and several say who to
// notify -- so they arrive with those gaps named in the "missing something"
// check rather than half-working.

import { CAMPAIGN_TEMPLATES, fillClinicPlaceholders } from './campaignTemplates'
import { DEFAULT_QUIET_HOURS, type Pair } from './automationCatalog'
import { newStepId, type DraftRule, type DraftStep } from './automationTree'

export interface TemplateStep {
  type: string
  config?: Record<string, any>
  yes?: TemplateStep[]
  no?: TemplateStep[]
  met?: TemplateStep[]
  timeout?: TemplateStep[]
}

export interface AutomationTemplate {
  key: string
  section: 'flows' | 'emails'
  name: Pair
  description: Pair
  /** "Cita completada · 6 pasos · con condiciones" */
  summary: Pair
  marketing?: boolean
  growth?: boolean
  rule: Omit<DraftRule, 'name'>
  steps: TemplateStep[]
}

const DAY = 1440
const wa = (variables: string[] = ['first_name']): TemplateStep => ({
  type: 'whatsapp_template',
  config: { template_name: '', template_language: 'es', variables: variables.map((source) => ({ source })), doc_template_ids: [] },
})
const email = (subject: string, body: string): TemplateStep => ({ type: 'email', config: { subject, body } })
const baseRule = (trigger: string, extra: Partial<DraftRule> = {}): Omit<DraftRule, 'name'> => ({
  trigger_event: trigger,
  filters: {},
  is_marketing: false,
  dry_run: false,
  entry_mode: 'every_time',
  exit_on: [],
  quiet_hours: null,
  segment: null,
  ...extra,
})

export const FLOW_TEMPLATES: AutomationTemplate[] = [
  {
    key: 'win-back-after-visit',
    section: 'flows',
    name: ['Win back after the visit', 'Recuperar tras la visita'],
    description: [
      'If they have no next appointment after 2 days, a WhatsApp; if they do not book within 7 days, a notification for the front desk.',
      'Si en 2 días no tiene próxima cita, WhatsApp; si en 7 días no reserva, aviso para Recepción.',
    ],
    summary: ['Appointment completed · 6 steps · with conditions', 'Cita completada · 6 pasos · con condiciones'],
    rule: baseRule('appointment.completed', { entry_mode: 'one_at_a_time', quiet_hours: DEFAULT_QUIET_HOURS }),
    steps: [
      { type: 'delay', config: { delay_minutes: 2 * DAY } },
      {
        type: 'branch',
        config: { title: '¿Tiene una cita futura?', match: 'all', conditions: [{ field: 'has_future_appointment', op: 'is_true' }] },
        yes: [],
        no: [
          wa(),
          {
            type: 'wait_until',
            config: { event: 'appointment.booked', timeout_minutes: 7 * DAY },
            met: [{ type: 'tag', config: { mode: 'add', tag: 'recuperado' } }],
            timeout: [{ type: 'notify', config: { to: { practitioner_of_appointment: true }, title: 'Llamar para su revisión' } }],
          },
        ],
      },
    ],
  },
  {
    key: 'lapsed-patients',
    section: 'flows',
    name: ['Patients who do not come back', 'Pacientes que no vuelven'],
    description: ['Every week, to whoever has not been in for 6 months and has nothing booked.', 'Cada semana, a quien no viene hace 6 meses y no tiene cita.'],
    summary: ['Weekly group · 4 steps', 'Segmento semanal · 4 pasos'],
    marketing: true,
    rule: baseRule('segment', {
      is_marketing: true,
      entry_mode: 'one_at_a_time',
      quiet_hours: DEFAULT_QUIET_HOURS,
      segment: { filters: { last_visit_before_days: 180, has_future_appointment: false }, schedule: { kind: 'weekly', weekday: 1, time: '10:00' }, reentry_days: 90 },
    }),
    steps: [
      { type: 'tag', config: { mode: 'add', tag: 'reactivación' } },
      {
        type: 'branch',
        config: { title: '¿Aceptó WhatsApp comercial?', match: 'all', conditions: [{ field: 'marketing_channels', op: 'is', value: 'whatsapp' }] },
        yes: [wa()],
        no: [
          email(
            '{{first_name}}, ¿cómo va esa espalda?',
            '<p>Hola {{first_name}},</p><p>Hace tiempo que no te vemos por {{clinic_name}} y queríamos saber cómo estás.</p><p>Si te apetece volver, responde a este correo y te buscamos hueco.</p><p>{{clinic_name}}</p>',
          ),
        ],
      },
    ],
  },
  {
    key: 'first-visit-welcome',
    section: 'flows',
    name: ['First visit welcome', 'Bienvenida a primera visita'],
    description: ['What to bring, how to get there and the form, as soon as they book.', 'Qué traer, cómo llegar y el formulario, al reservar.'],
    summary: ['Appointment booked · 2 steps', 'Cita reservada · 2 pasos'],
    rule: baseRule('appointment.booked', { filters: { no_prior_appointments: true } }),
    steps: [wa(['first_name', 'next_appointment']), email('¡Bienvenido/a a {{clinic_name}}!', CAMPAIGN_TEMPLATES[0]!.body.es)],
  },
  {
    key: 'ask-for-review',
    section: 'flows',
    name: ['Ask for a review', 'Pedir reseña'],
    description: ['Two days later, only to patients with no incident on their record.', 'Dos días después, solo a quien no tuvo incidencias.'],
    summary: ['2 days after · 2 steps', '2 días después · 2 pasos'],
    rule: baseRule('appointment.review_request', { filters: { days_after: 2 }, quiet_hours: DEFAULT_QUIET_HOURS }),
    steps: [
      {
        type: 'branch',
        config: { title: '¿Sin incidencias?', match: 'all', conditions: [{ field: 'tags', op: 'not_contains', value: 'incidencia' }] },
        yes: [wa(['first_name', 'google_review_link'])],
        no: [],
      },
    ],
  },
  {
    key: 'birthday',
    section: 'flows',
    name: ['Birthday', 'Cumpleaños'],
    description: ['A birthday note with a small gift.', 'Felicitación con un detalle.'],
    summary: ['Birthday · 1 step', 'Cumpleaños · 1 paso'],
    marketing: true,
    rule: baseRule('patient.birthday', { is_marketing: true }),
    steps: [email('¡Feliz cumpleaños, {{first_name}}!', CAMPAIGN_TEMPLATES.find((c) => c.key === 'birthday-active')!.body.es)],
  },
  {
    key: 'reminder-24h',
    section: 'flows',
    name: ['24 h reminder', 'Recordatorio 24 h'],
    description: ['With buttons to confirm or change.', 'Con botones para confirmar o cambiar.'],
    summary: ['24 h before · 1 step', '24 h antes · 1 paso'],
    rule: baseRule('appointment.hours_before', { filters: { hours_before: 24 } }),
    steps: [wa(['first_name', 'appointment_date', 'appointment_time'])],
  },
  {
    key: 'no-show',
    section: 'flows',
    name: ['Did not attend', 'No asistió'],
    description: ['A kind message to rebook, and a notification if they do not reply.', 'Mensaje amable para reprogramar, y aviso si no responde.'],
    summary: ['Did not attend · 4 steps', 'No asistió · 4 pasos'],
    rule: baseRule('appointment.no_show', { quiet_hours: DEFAULT_QUIET_HOURS, exit_on: ['appointment.booked'] }),
    steps: [
      { type: 'tag', config: { mode: 'add', tag: 'no asistió' } },
      wa(),
      {
        type: 'wait_until',
        config: { event: 'whatsapp.replied', timeout_minutes: 2 * DAY },
        met: [],
        timeout: [{ type: 'notify', config: { to: { practitioner_of_appointment: true }, title: 'No vino y no ha respondido: llamar' } }],
      },
    ],
  },
  {
    key: 'ad-lead',
    section: 'flows',
    name: ['Ad lead', 'Lead de anuncio'],
    description: ['An answer within minutes, a follow-up after 2 days, a notification if they do not reply.', 'Respuesta en minutos, seguimiento a los 2 días, aviso si no contesta.'],
    summary: ['New lead · 5 steps', 'Lead nuevo · 5 pasos'],
    growth: true,
    rule: baseRule('lead.created', { entry_mode: 'once_ever', exit_on: ['lead.converted'] }),
    steps: [
      wa(),
      { type: 'lead_stage', config: { stage: 'contacted' } },
      {
        type: 'wait_until',
        config: { event: 'whatsapp.replied', timeout_minutes: 2 * DAY },
        met: [],
        timeout: [wa(), { type: 'notify', config: { to: {}, title: 'Lead sin respuesta' } }],
      },
    ],
  },
]

/** The Campaigns starter emails, unchanged, as one-step automations. */
export const EMAIL_TEMPLATES: AutomationTemplate[] = CAMPAIGN_TEMPLATES.map((c) => ({
  key: c.key,
  section: 'emails' as const,
  name: [c.name.en, c.name.es] as Pair,
  description: [c.description.en, c.description.es] as Pair,
  summary: ['Email · 1 step', 'Email · 1 paso'] as Pair,
  marketing: c.isMarketing,
  rule: baseRule(c.triggerEvent, { filters: { ...c.filters }, is_marketing: c.isMarketing }),
  steps: [{ type: 'email', config: { subject: c.subject, body: c.body } }],
}))

export const AUTOMATION_TEMPLATES = [...FLOW_TEMPLATES, ...EMAIL_TEMPLATES]

/**
 * A template as a rule and steps ready to POST: fresh ids, the clinic's name
 * and address written in, and the email copy in the clinic's language.
 * Campaign emails carry both languages; the flows are written in Spanish,
 * which is what the clinics using them speak.
 */
export function instantiateTemplate(
  tpl: AutomationTemplate,
  lang: 'en' | 'es',
  clinic: { name: string; address?: string | null } | null,
): { rule: DraftRule; steps: DraftStep[] } {
  const steps: DraftStep[] = []
  const campaign = CAMPAIGN_TEMPLATES.find((c) => c.key === tpl.key)
  const fill = (text: string) => (clinic ? fillClinicPlaceholders(text, clinic) : text)

  const add = (list: TemplateStep[], parentId: string | null, branch: string | null) => {
    list.forEach((step, position) => {
      const id = newStepId()
      let config = JSON.parse(JSON.stringify(step.config ?? {}))
      if (step.type === 'email') {
        const subject = campaign ? (lang === 'en' ? campaign.subject.en : campaign.subject.es) : config.subject
        const body = campaign ? (lang === 'en' ? campaign.body.en : campaign.body.es) : config.body
        config = { ...config, subject: fill(subject), body: fill(body) }
      }
      steps.push({ id, action_type: step.type, config, parent_id: parentId, branch, position })
      for (const outlet of ['yes', 'no', 'met', 'timeout'] as const) if (step[outlet]) add(step[outlet]!, id, outlet)
    })
  }
  add(tpl.steps, null, null)

  return {
    rule: { ...JSON.parse(JSON.stringify(tpl.rule)), name: lang === 'en' ? tpl.name[0] : tpl.name[1] },
    steps,
  }
}
