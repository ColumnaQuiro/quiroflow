// Automations to start from: the flows on the Templates board, built as trees,
// and the eight patient emails Campaigns offered (utils/campaignTemplates.ts),
// each a one-step automation as before.
//
// Everything is created PAUSED. Most flows need a WhatsApp template the clinic
// has to choose (Meta approves each clinic's own), and several say who to
// notify -- so they arrive with those gaps named in the "missing something"
// check rather than half-working.
//
// The recall flows are deliberately NOT marketing. A marketing segment only
// reaches patients with the channel in marketing_channels, and a clinic
// whose records came from elsewhere has that for almost nobody -- the old
// "Pacientes que no vuelven" would have WhatsApped nine people out of nine
// hundred. A recall is part of the patient's care; refusing works through
// the reply itself (utils/recallReply.ts), which the activation dialog says.

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
const wa = (variables: string[] = ['first_name'], extra: Record<string, any> = {}): TemplateStep => ({
  type: 'whatsapp_template',
  config: { template_name: '', template_language: 'es', variables: variables.map((source) => ({ source })), doc_template_ids: [], ...extra },
})
// A recall's WhatsApp: "soy Léa", from the patient's own practitioner, and
// flagged purpose 'recall' so it is the patient's last contact on the Recalls
// page and grouped with recalls in Reports. No booking link: at most clinics
// only a first visit is bookable online, and a returning patient answers the
// template's quick replies instead (the Receptionist add-on offers free times).
const recallWa = () => wa(['first_name', 'practitioner_first_name'], { purpose: 'recall' })
// Non-marketing recall segments share these: nobody messaged by anyone in
// the last month, quiet hours, one run per patient at a time, and a daily
// cap so a long list goes out over days (about one old number in nine no
// longer answers, and failures count against the WhatsApp number).
const recallSegment = (filters: Record<string, unknown>, reentryDays: number, dailyLimit: number): Omit<DraftRule, 'name'> =>
  baseRule('segment', {
    entry_mode: 'one_at_a_time',
    quiet_hours: DEFAULT_QUIET_HOURS,
    exit_on: ['appointment.booked'],
    segment: {
      filters: { ...filters, has_future_appointment: false, no_whatsapp_sent_days: 30 },
      schedule: { kind: 'weekly', weekday: 1, time: '10:00' },
      reentry_days: reentryDays,
      daily_limit: dailyLimit,
    },
  })
const recallEmail = (subject: string, intro: string) =>
  email(subject, `<p>Hola {{first_name}},</p><p>${intro}</p><p>Si te apetece volver, responde a este correo o reserva aquí: <a href="{{booking_link}}">{{booking_link}}</a></p><p>{{practitioner_first_name}} · {{clinic_name}}</p>`)
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
          recallWa(),
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
  // The three recall segments (docs/recall-automation-plan.md, section 4).
  // Continuity of care rather than marketing: they reach every patient in
  // the band, not the handful with WhatsApp marketing consent recorded, and a
  // "No, gracias" reply marks the patient do-not-contact (the webhook does
  // that; the activation dialog says so). The wait is on a reply, and a
  // booking exits the rule, so nobody gets the follow-up after answering.
  {
    key: 'recall-second-visit',
    section: 'flows',
    name: ['Second visit pending', 'Segunda visita pendiente'],
    description: [
      'Every week, to whoever came once, 3 weeks to 4 months ago, and never came back: a WhatsApp from their practitioner; if no reply in 5 days, an email; if nothing in 7 more, a task for the practitioner to call. 15 a day.',
      'Cada semana, a quien vino una vez, hace entre 3 semanas y 4 meses, y no volvió: WhatsApp de su profesional; si en 5 días no responde, email; si en 7 más nada, tarea para que le llame. 15 al día.',
    ],
    summary: ['Weekly group · 5 steps · with waits', 'Segmento semanal · 5 pasos · con esperas'],
    rule: recallSegment({ min_visits: 1, max_visits: 1, last_visit_before_days: 21, last_visit_within_days: 120 }, 180, 15),
    steps: [
      recallWa(),
      {
        type: 'wait_until',
        config: { event: 'whatsapp.replied', timeout_minutes: 5 * DAY },
        met: [],
        timeout: [
          recallEmail('{{first_name}}, ¿cómo sigues?', 'Después de tu primera visita me quedé con ganas de saber cómo sigues. Tu valoración y el informe siguen aquí: en la segunda visita te los explico y vemos juntos si tiene sentido seguir, sin compromiso.'),
          {
            type: 'wait_until',
            config: { event: 'whatsapp.replied', timeout_minutes: 7 * DAY },
            met: [],
            timeout: [{ type: 'notify', config: { to: { patients_practitioner: true }, title: 'Llamar a {{first_name}}: segunda visita pendiente' } }],
          },
        ],
      },
    ],
  },
  {
    key: 'recall-maintenance-3m',
    section: 'flows',
    name: ['Maintenance: 3 months away', 'Mantenimiento: 3 meses sin venir'],
    description: [
      'Every week, to whoever has been twice or more and was last seen 3 to 6 months ago, with nothing booked: a WhatsApp from their practitioner; if no reply in 5 days, a second one; if nothing in 7 more, a tag. 40 a day.',
      'Cada semana, a quien ha venido dos o más veces, hace entre 3 y 6 meses, y no tiene cita: WhatsApp de su profesional; si en 5 días no responde, un segundo; si en 7 más nada, etiqueta. 40 al día.',
    ],
    summary: ['Weekly group · 5 steps · with waits', 'Segmento semanal · 5 pasos · con esperas'],
    rule: recallSegment({ min_visits: 2, last_visit_before_days: 90, last_visit_within_days: 180 }, 120, 40),
    steps: [
      recallWa(),
      {
        type: 'wait_until',
        config: { event: 'whatsapp.replied', timeout_minutes: 5 * DAY },
        met: [],
        timeout: [
          recallWa(),
          {
            type: 'wait_until',
            config: { event: 'whatsapp.replied', timeout_minutes: 7 * DAY },
            met: [],
            timeout: [{ type: 'tag', config: { mode: 'add', tag: 'recall · sin respuesta' } }],
          },
        ],
      },
    ],
  },
  {
    key: 'recall-reactivation-6m',
    section: 'flows',
    name: ['Reactivation: 6 to 12 months', 'Reactivación: 6 a 12 meses'],
    description: [
      'Every week, to whoever has been twice or more and was last seen 6 to 12 months ago, with nothing booked: a WhatsApp from their practitioner; if no reply in 7 days, an email; if nothing in 14 more, a tag. 40 a day.',
      'Cada semana, a quien ha venido dos o más veces, hace entre 6 y 12 meses, y no tiene cita: WhatsApp de su profesional; si en 7 días no responde, email; si en 14 más nada, etiqueta. 40 al día.',
    ],
    summary: ['Weekly group · 5 steps · with waits', 'Segmento semanal · 5 pasos · con esperas'],
    rule: recallSegment({ min_visits: 2, last_visit_before_days: 180, last_visit_within_days: 365 }, 180, 40),
    steps: [
      recallWa(),
      {
        type: 'wait_until',
        config: { event: 'whatsapp.replied', timeout_minutes: 7 * DAY },
        met: [],
        timeout: [
          recallEmail('{{first_name}}, hace tiempo que no te vemos', 'Hace más de seis meses que no te vemos por {{clinic_name}} y quería saber cómo estás. Si notas que la espalda vuelve a pedir atención, tenemos la visita de reactivación con chequeo postural incluido: vemos cómo estás ahora y retomamos desde ahí.'),
          {
            type: 'wait_until',
            config: { event: 'whatsapp.replied', timeout_minutes: 14 * DAY },
            met: [],
            timeout: [{ type: 'tag', config: { mode: 'add', tag: 'recall · sin respuesta' } }],
          },
        ],
      },
    ],
  },
  {
    key: 'unfinished-care-plans',
    section: 'flows',
    name: ['Unfinished care plans', 'Planes sin terminar'],
    description: [
      'Every week, to whoever is a visit behind on their care plan and has nothing booked: a WhatsApp with the booking link; if they do not book within 7 days, a notification for their practitioner.',
      'Cada semana, a quien va con una visita de retraso en su plan y no tiene cita: WhatsApp con el enlace de reserva; si en 7 días no reserva, aviso para su profesional.',
    ],
    summary: ['Weekly group · 4 steps · with a wait', 'Segmento semanal · 4 pasos · con espera'],
    rule: baseRule('segment', {
      entry_mode: 'one_at_a_time',
      quiet_hours: DEFAULT_QUIET_HOURS,
      // Part of the treatment they started, not marketing -- the same footing
      // as a recall. reentry_days so nobody is chased every week.
      segment: { filters: { care_plan_overdue_days: 7, has_future_appointment: false }, schedule: { kind: 'weekly', weekday: 1, time: '10:00' }, reentry_days: 30 },
    }),
    steps: [
      { type: 'tag', config: { mode: 'add', tag: 'plan sin terminar' } },
      wa(['first_name', 'booking_link']),
      {
        type: 'wait_until',
        config: { event: 'appointment.booked', timeout_minutes: 7 * DAY },
        met: [{ type: 'tag', config: { mode: 'add', tag: 'recuperado' } }],
        timeout: [{ type: 'notify', config: { to: { patients_practitioner: true }, title: 'Llamar a {{first_name}}: plan sin terminar' } }],
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
    key: 'satisfaction-check',
    section: 'flows',
    name: ['How did we do?', '¿Qué tal te hemos atendido?'],
    description: ['A 1 to 5 two hours after the first visit and every 10th. Low scores alert the owners; high ones are offered your Google review page.', 'Del 1 al 5, dos horas después de la primera visita y cada 10. Las notas bajas avisan a los propietarios; las altas, a dejar reseña en Google.'],
    summary: ['2 h after the visit · 1 step', '2 h después de la visita · 1 paso'],
    rule: baseRule('appointment.satisfaction', { filters: { hours_after: 2, first_visit: true, every_visits: 10 }, quiet_hours: DEFAULT_QUIET_HOURS }),
    steps: [wa(['first_name', 'satisfaction_link'])],
  },
  {
    key: 'payment-reminder',
    section: 'flows',
    name: ['Payment reminder', 'Recordatorio de pago'],
    description: ['A week after an unpaid invoice: the amount and a link to pay by card.', 'Una semana después de una factura sin pagar: el importe y un enlace para pagar con tarjeta.'],
    summary: ['Invoice unpaid after 7 days · 1 step', 'Factura sin pagar a los 7 días · 1 paso'],
    rule: baseRule('invoice.overdue', { filters: { days_overdue: 7 }, quiet_hours: DEFAULT_QUIET_HOURS }),
    steps: [
      email(
        'Tu factura {{invoice_number}} de {{clinic_name}}',
        '<p>Hola {{first_name}},</p><p>Te recordamos que la factura {{invoice_number}} tiene pendientes {{invoice_amount_owed}}.</p><p>Puedes pagarla con tarjeta aquí: <a href="{{invoice_pay_link}}">{{invoice_pay_link}}</a></p><p>Si ya la has pagado, no hagas caso de este mensaje. ¡Gracias!</p><p>{{clinic_name}}</p>',
      ),
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
    rule: baseRule('appointment.hours_before', { filters: { hours_before: 24, skip_if_answered: true } }),
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
