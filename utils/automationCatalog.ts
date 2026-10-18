// Everything the Automations screens name: triggers, steps, the events a wait
// or an exit can listen for, the questions a condition can ask and the filters
// a trigger can narrow on. One place, in both languages, so the list, the
// canvas, the inspector and the server's validation all describe a rule with
// the same words -- and so the server can reject exactly what the client
// would not offer.
//
// Pure data and small pure helpers only: imported by pages, components and
// server routes alike.

export type Pair = readonly [en: string, es: string]
export type Translate = (en: string, es: string) => string
export const say = (t: Translate, pair: Pair) => t(pair[0], pair[1])

// ------------------------------------------------------------------ triggers

export interface TriggerDef {
  value: string
  label: Pair
  /** "When…" sentence in the trigger panel's picker. */
  sentence: Pair
  description: Pair
  group: 'appointment' | 'money' | 'patient' | 'membership' | 'waitlist' | 'segment' | 'lead'
  /** An appointment is in scope, so appointment-type / practitioner filters can apply. */
  appointmentContext: boolean
  /** Lead triggers are part of Growth. */
  growth?: boolean
}

export const TRIGGERS: TriggerDef[] = [
  {
    value: 'appointment.booked',
    label: ['Appointment booked', 'Cita reservada'],
    sentence: ['An appointment is booked', 'Se reserva una cita'],
    description: ['As soon as an appointment is booked in the app.', 'En cuanto se reserva una cita desde la app.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.checked_in',
    label: ['Patient checked in', 'Check-in del paciente'],
    sentence: ['The front desk checks a patient in', 'Recepción hace el check-in de un paciente'],
    description: ['The moment the front desk checks the patient in for their visit.', 'En el momento en que recepción registra la llegada del paciente.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.completed',
    label: ['Appointment completed', 'Cita completada'],
    sentence: ['An appointment is marked completed', 'Una cita se marca como completada'],
    description: ['Right after a visit is marked completed.', 'Justo después de marcar una visita como completada.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.cancelled',
    label: ['Appointment cancelled', 'Cita cancelada'],
    sentence: ['An appointment is cancelled', 'Se cancela una cita'],
    description: ['When an appointment is cancelled.', 'Cuando se cancela una cita.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.rescheduled',
    label: ['Appointment rescheduled', 'Cita reprogramada'],
    sentence: ['An appointment moves to another time', 'Una cita cambia de fecha u hora'],
    description: ["When an appointment's date or time changes.", 'Cuando cambia la fecha o la hora de una cita.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.no_show',
    label: ['Did not attend', 'No asistió'],
    sentence: ['An appointment is marked as missed', 'Una cita se marca como no asistida'],
    description: ['When an appointment is marked as a missed visit.', 'Cuando una cita se marca como no asistida.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.hours_before',
    label: ['Hours before the appointment', 'Horas antes de la cita'],
    sentence: ['A set number of hours before an appointment', 'Un número de horas antes de una cita'],
    description: ['Checked every 15 minutes; fires once per appointment and rule.', 'Se comprueba cada 15 minutos; salta una vez por cita y automatización.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.same_day',
    label: ['Day of the appointment, 9:00', 'El mismo día de la cita, a las 9:00'],
    sentence: ['The morning of an appointment', 'La mañana de la cita'],
    description: ['Once a day around 9:00, for every appointment booked that day.', 'Una vez al día hacia las 9:00, para cada cita reservada ese día.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.review_request',
    label: ['Days after the visit (review)', 'Días después de la cita (reseña)'],
    sentence: ['A set number of days after a completed visit', 'Un número de días después de una visita completada'],
    description: ['Use the Google review link variable to link straight to your review page.', 'Usa la variable del enlace de reseña de Google para enlazar directamente a tu página de reseñas.'],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'appointment.satisfaction',
    label: ['After the visit (satisfaction)', 'Después de la visita (satisfacción)'],
    sentence: ['Hours after the first visit and every few visits', 'Unas horas después de la primera visita y cada pocas visitas'],
    description: [
      'Asks "how did we do?" from 1 to 5 with the satisfaction link variable. Never more than once a month per patient; low scores reach the owners on Reputation.',
      'Pregunta «¿qué tal te hemos atendido?» del 1 al 5 con la variable del enlace para valorar. Nunca más de una vez al mes por paciente; las notas bajas llegan a los propietarios en Reputación.',
    ],
    group: 'appointment',
    appointmentContext: true,
  },
  {
    value: 'invoice.overdue',
    label: ['Invoice unpaid', 'Factura sin pagar'],
    sentence: ['A set number of days after an invoice, still unpaid', 'Un número de días después de una factura, sin pagar'],
    description: [
      'Checked once a day. Use the payment link variable so they can pay by card; a second reminder is another automation with more days. Patients with reminders paused are skipped.',
      'Se comprueba una vez al día. Usa la variable del enlace de pago para que paguen con tarjeta; un segundo recordatorio es otra automatización con más días. Se omite a los pacientes con los recordatorios pausados.',
    ],
    group: 'money',
    appointmentContext: false,
  },
  {
    value: 'invoice.paid',
    label: ['Invoice paid', 'Factura pagada'],
    sentence: ['An invoice is paid in full', 'Se paga una factura por completo'],
    description: ['Once an invoice is marked paid in full.', 'Cuando una factura se marca como pagada por completo.'],
    group: 'money',
    appointmentContext: true,
  },
  {
    value: 'patient.referred',
    label: ['Patient referred someone', 'Paciente referido'],
    sentence: ['A patient refers someone new', 'Un paciente refiere a alguien nuevo'],
    description: ['For the referring patient, as soon as they are linked as the referrer of a new patient.', 'Para quien refirió, en cuanto se le vincula como referente de un paciente nuevo.'],
    group: 'patient',
    appointmentContext: false,
  },
  {
    value: 'membership.new_member',
    label: ['Membership started', 'Alta de membresía'],
    sentence: ['A patient starts a membership', 'Un paciente inicia una membresía'],
    description: ['When a patient starts a new membership.', 'Cuando un paciente inicia una membresía.'],
    group: 'membership',
    appointmentContext: false,
  },
  {
    value: 'membership.removed',
    label: ['Membership cancelled', 'Baja de membresía'],
    sentence: ["A patient's membership is cancelled", 'Se cancela la membresía de un paciente'],
    description: ["When a patient's membership is cancelled.", 'Cuando se cancela la membresía de un paciente.'],
    group: 'membership',
    appointmentContext: false,
  },
  {
    value: 'membership.payment_processed',
    label: ['Membership payment', 'Pago de membresía'],
    sentence: ['A membership charge succeeds', 'Se cobra una cuota de membresía'],
    description: ['Each time a recurring membership charge succeeds through Stripe.', 'Cada vez que un cobro recurrente de membresía se realiza a través de Stripe.'],
    group: 'membership',
    appointmentContext: false,
  },
  {
    value: 'waitlist.slot_offered',
    label: ['Waitlist slot offered', 'Hueco ofrecido de la lista de espera'],
    sentence: ['A freed slot is offered from the waitlist', 'Se ofrece un hueco libre a la lista de espera'],
    description: ['When a cancelled appointment is offered to the next patient on the waitlist.', 'Cuando una cita cancelada se ofrece al siguiente paciente de la lista de espera.'],
    group: 'waitlist',
    appointmentContext: false,
  },
  {
    value: 'patient.birthday',
    label: ["Patient's birthday", 'Cumpleaños del paciente'],
    sentence: ["It is a patient's birthday", 'Es el cumpleaños de un paciente'],
    description: ['Once a day, for every patient whose birthday is today.', 'Una vez al día, para cada paciente que cumple años hoy.'],
    group: 'patient',
    appointmentContext: false,
  },
  {
    value: 'segment',
    label: ['A group of patients', 'Un segmento de pacientes'],
    sentence: ['A group of patients, once or on a schedule', 'Un grupo de pacientes, una vez o con un horario'],
    description: ['Everyone who matches the filters enters, once or every day or week.', 'Entran todos los que cumplen los filtros, una vez o cada día o semana.'],
    group: 'segment',
    appointmentContext: false,
  },
  {
    value: 'lead.created',
    label: ['New lead', 'Lead nuevo'],
    sentence: ['A new lead arrives', 'Llega un lead nuevo'],
    description: ['From Meta Ads, the web form or the public API.', 'De Meta Ads, del formulario web o de la API pública.'],
    group: 'lead',
    appointmentContext: false,
    growth: true,
  },
]

export const TRIGGER_GROUPS: { key: TriggerDef['group']; label: Pair }[] = [
  { key: 'appointment', label: ['Appointments', 'Citas'] },
  { key: 'money', label: ['Billing', 'Facturación'] },
  { key: 'patient', label: ['Patients', 'Pacientes'] },
  { key: 'membership', label: ['Memberships', 'Membresías'] },
  { key: 'waitlist', label: ['Waitlist', 'Lista de espera'] },
  { key: 'segment', label: ['Groups', 'Grupos'] },
  { key: 'lead', label: ['Leads', 'Leads'] },
]

export const triggerDef = (value: string) => TRIGGERS.find((tr) => tr.value === value) ?? null
export const isLeadTrigger = (value: string) => value === 'lead.created'

/** The trigger as the list and the canvas name it, with its number filled in. */
export function triggerTitle(t: Translate, event: string, filters?: Record<string, unknown> | null): string {
  if (event === 'appointment.hours_before') {
    const h = Number(filters?.hours_before) || 24
    return t(`${h} hours before the appointment`, `${h} horas antes de la cita`)
  }
  if (event === 'appointment.review_request') {
    const d = Number(filters?.days_after) || 2
    return t(`${d} day${d === 1 ? '' : 's'} after the visit`, `${d} día${d === 1 ? '' : 's'} después de la cita`)
  }
  if (event === 'appointment.satisfaction') {
    const h = Number(filters?.hours_after) || 2
    const n = filters?.every_visits === undefined ? 10 : Number(filters.every_visits) || 0
    const first = filters?.first_visit !== false
    const when = [first ? t('the first visit', 'la primera visita') : '', n > 0 ? t(`every ${n} visits`, `cada ${n} visitas`) : ''].filter(Boolean).join(t(' and ', ' y '))
    return t(`${h} h after ${when || 'the visit'}`, `${h} h después de ${when || 'la visita'}`)
  }
  if (event === 'invoice.overdue') {
    const d = Number(filters?.days_overdue) || 7
    return t(`Invoice unpaid after ${d} day${d === 1 ? '' : 's'}`, `Factura sin pagar a los ${d} día${d === 1 ? '' : 's'}`)
  }
  const def = triggerDef(event)
  return def ? say(t, def.label) : event
}

// ------------------------------------------------------------------ steps

export type StepType =
  | 'whatsapp_template'
  | 'email'
  | 'webhook'
  | 'delay'
  | 'wait_until'
  | 'branch'
  | 'tag'
  | 'notify'
  | 'lead_stage'
  | 'lead_assign'

export type StepKind = 'message' | 'wait' | 'condition' | 'action'

export interface StepDef {
  type: StepType
  label: Pair
  hint: Pair
  group: 'messages' | 'time' | 'logic' | 'actions' | 'leads'
  kind: StepKind
  /** Only in lead rules, and only with Growth. */
  leadOnly?: boolean
  /** Two outlets below it rather than one chain after it. */
  outlets?: readonly [string, string]
}

export const STEP_TYPES: StepDef[] = [
  { type: 'whatsapp_template', label: ['WhatsApp', 'WhatsApp'], hint: ['A template approved by Meta', 'Una plantilla aprobada por Meta'], group: 'messages', kind: 'message' },
  { type: 'email', label: ['Email', 'Email'], hint: ["Subject and body with the patient's details", 'Asunto y cuerpo con los datos del paciente'], group: 'messages', kind: 'message' },
  { type: 'delay', label: ['Wait', 'Esperar'], hint: ['A while before the next step', 'Un tiempo antes del siguiente paso'], group: 'time', kind: 'wait' },
  { type: 'wait_until', label: ['Wait until…', 'Esperar hasta que…'], hint: ['They book, reply, pay or open the email · with a limit', 'Reserve, responda, pague o abra el email · con límite'], group: 'time', kind: 'wait', outlets: ['met', 'timeout'] },
  { type: 'branch', label: ['If / else', 'Si / si no'], hint: ['Two paths depending on their details', 'Dos caminos según sus datos'], group: 'logic', kind: 'condition', outlets: ['yes', 'no'] },
  { type: 'tag', label: ['Add or remove a tag', 'Añadir o quitar etiqueta'], hint: ["On the patient's record", 'En la ficha del paciente'], group: 'actions', kind: 'action' },
  { type: 'notify', label: ['Notify someone on the team', 'Avisar a alguien del equipo'], hint: ['A notification on their phone and in the app', 'Un aviso en su móvil y en la app'], group: 'actions', kind: 'action' },
  { type: 'webhook', label: ['Webhook', 'Webhook'], hint: ['Send the data to another app', 'Envía los datos a otra aplicación'], group: 'actions', kind: 'action' },
  { type: 'lead_stage', label: ['Change lead stage', 'Cambiar etapa del lead'], hint: ['New, contacted, booked, lost…', 'Nuevo, contactado, cita, perdido…'], group: 'leads', kind: 'action', leadOnly: true },
  { type: 'lead_assign', label: ['Assign the lead', 'Asignar el lead'], hint: ['To someone on the team', 'A alguien del equipo'], group: 'leads', kind: 'action', leadOnly: true },
]

export const STEP_GROUPS: { key: StepDef['group']; label: Pair }[] = [
  { key: 'messages', label: ['Messages', 'Mensajes'] },
  { key: 'time', label: ['Time', 'Tiempo'] },
  { key: 'logic', label: ['Logic', 'Lógica'] },
  { key: 'actions', label: ['Actions', 'Acciones'] },
  { key: 'leads', label: ['Leads', 'Leads'] },
]

export const KIND_LABEL: Record<StepKind | 'trigger' | 'end', Pair> = {
  trigger: ['Trigger', 'Disparador'],
  message: ['Message', 'Mensaje'],
  wait: ['Wait', 'Espera'],
  condition: ['Condition', 'Condición'],
  action: ['Action', 'Acción'],
  end: ['End', 'Fin'],
}

export const stepDef = (type: string) => STEP_TYPES.find((s) => s.type === type) ?? null
export const MESSAGE_STEPS: readonly string[] = ['whatsapp_template', 'email', 'webhook']
export const OUTLETS: Record<string, readonly [string, string]> = { branch: ['yes', 'no'], wait_until: ['met', 'timeout'] }

// ------------------------------------------------------------------ time

export const DELAY_UNITS = [
  { value: 'minutes', label: ['minutes', 'minutos'] as Pair, minutes: 1 },
  { value: 'hours', label: ['hours', 'horas'] as Pair, minutes: 60 },
  { value: 'days', label: ['days', 'días'] as Pair, minutes: 1440 },
] as const

export function splitMinutes(minutes: number): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m > 0 && m % 1440 === 0) return { value: m / 1440, unit: 'days' }
  if (m > 0 && m % 60 === 0) return { value: m / 60, unit: 'hours' }
  return { value: m, unit: 'minutes' }
}

export function durationText(t: Translate, minutes: number): string {
  const { value, unit } = splitMinutes(minutes)
  if (unit === 'days') return t(`${value} day${value === 1 ? '' : 's'}`, `${value} día${value === 1 ? '' : 's'}`)
  if (unit === 'hours') return t(`${value} hour${value === 1 ? '' : 's'}`, `${value} hora${value === 1 ? '' : 's'}`)
  return t(`${value} min`, `${value} min`)
}

// ------------------------------------------------------------------ waits and exits

export interface WaitEventDef {
  value: string
  /** "Wait until they …" */
  until: Pair
  /** Picker label, "Reserve una cita". */
  label: Pair
  met: Pair
  /** Followed by a duration: "No reservó en 7 días". */
  timeoutPrefix: Pair
}

export const WAIT_EVENTS: WaitEventDef[] = [
  { value: 'appointment.booked', until: ['Wait until they book', 'Esperar hasta que reserve'], label: ['They book an appointment', 'Reserve una cita'], met: ['Booked', 'Reservó'], timeoutPrefix: ['Did not book in', 'No reservó en'] },
  { value: 'whatsapp.replied', until: ['Wait until they reply', 'Esperar hasta que responda'], label: ['They reply on WhatsApp', 'Responda por WhatsApp'], met: ['Replied', 'Respondió'], timeoutPrefix: ['No reply in', 'No respondió en'] },
  { value: 'invoice.paid', until: ['Wait until they pay', 'Esperar hasta que pague'], label: ['They pay what they owe', 'Pague lo pendiente'], met: ['Paid', 'Pagó'], timeoutPrefix: ['Did not pay in', 'No pagó en'] },
  { value: 'email.opened', until: ['Wait until they open the email', 'Esperar hasta que abra el email'], label: ['They open the email', 'Abra el email'], met: ['Opened', 'Lo abrió'], timeoutPrefix: ['Not opened in', 'No lo abrió en'] },
  { value: 'email.clicked', until: ['Wait until they click the email', 'Esperar hasta que haga clic'], label: ['They click a link in the email', 'Haga clic en el email'], met: ['Clicked', 'Hizo clic'], timeoutPrefix: ['No click in', 'No hizo clic en'] },
  { value: 'appointment.checked_in', until: ['Wait until they check in', 'Esperar hasta que haga check-in'], label: ['They check in', 'Haga check-in'], met: ['Checked in', 'Hizo check-in'], timeoutPrefix: ['No check-in in', 'Sin check-in en'] },
  { value: 'doc.completed', until: ['Wait until they complete the form', 'Esperar hasta que complete el formulario'], label: ['They complete a form', 'Complete un formulario'], met: ['Completed', 'Lo completó'], timeoutPrefix: ['Not completed in', 'No lo completó en'] },
]
export const waitEventDef = (value: string) => WAIT_EVENTS.find((w) => w.value === value) ?? null

export const EXIT_EVENTS: { value: string; label: Pair; hint: Pair; leadOnly?: boolean }[] = [
  { value: 'appointment.booked', label: ['Books an appointment', 'Reserva una cita'], hint: ['Once they have come back, there is no point in insisting.', 'Para quien ya ha vuelto, no tiene sentido seguir insistiendo.'] },
  { value: 'whatsapp.replied', label: ['Replies on WhatsApp', 'Responde por WhatsApp'], hint: ['A person on the team takes it from there.', 'Pasa a una persona del equipo.'] },
  { value: 'lead.converted', label: ['Becomes a patient (leads)', 'Se convierte en paciente (leads)'], hint: ['Lead automations only.', 'Solo automatizaciones de leads.'], leadOnly: true },
]

export const ENTRY_MODES: { value: 'every_time' | 'one_at_a_time' | 'once_ever'; label: Pair }[] = [
  { value: 'every_time', label: ['Enters again (once per trigger)', 'Entra otra vez (una por cada vez que ocurre)'] },
  { value: 'one_at_a_time', label: ['Not until they have finished', 'No entra hasta terminar'] },
  { value: 'once_ever', label: ['Only once, ever', 'Solo una vez en la vida'] },
]

export const DEFAULT_QUIET_HOURS = { from: '10:00', to: '20:00', days: [1, 2, 3, 4, 5, 6] }

const WEEKDAYS: Pair[] = [
  ['Monday', 'lunes'],
  ['Tuesday', 'martes'],
  ['Wednesday', 'miércoles'],
  ['Thursday', 'jueves'],
  ['Friday', 'viernes'],
  ['Saturday', 'sábado'],
  ['Sunday', 'domingo'],
]
export const weekdayName = (t: Translate, iso: number) => say(t, WEEKDAYS[((iso || 7) - 1) % 7]!)

export function quietHoursText(t: Translate, q: { from: string; to: string; days?: number[] } | null | undefined): string {
  if (!q) return ''
  const days = (q.days ?? []).map((d) => (d === 0 ? 7 : d)).sort()
  let range = ''
  if (days.length === 0 || days.length === 7) range = t('every day', 'todos los días')
  else if (days.join(',') === '1,2,3,4,5,6') range = t('Monday to Saturday', 'de lunes a sábado')
  else if (days.join(',') === '1,2,3,4,5') range = t('Monday to Friday', 'de lunes a viernes')
  else range = days.map((d) => weekdayName(t, d)).join(', ')
  return t(`Between ${q.from} and ${q.to}, ${range}`, `Entre ${q.from} y ${q.to}, ${range}`)
}

// ------------------------------------------------------------------ conditions

export type ValueKind = 'none' | 'text' | 'number' | 'multi' | 'balance' | 'channel' | 'doc_answer'
export type OptionSource = 'appointment_types' | 'practitioners' | 'lead_stages' | 'lead_channels' | 'clinics' | 'memberships'

export interface ConditionFieldDef {
  field: string
  label: Pair
  ops: { op: string; label: Pair }[]
  value: ValueKind
  options?: OptionSource
  /** Patients only / leads only; neither means both. */
  subject?: 'patient' | 'lead'
  /** Needs the appointment the run is about. */
  appointment?: boolean
}

const BOOL_OPS: ConditionFieldDef['ops'] = [
  { op: 'is_true', label: ['yes', 'sí'] },
  { op: 'is_false', label: ['no', 'no'] },
]
const EXISTS_OPS: ConditionFieldDef['ops'] = [
  { op: 'is_true', label: ['exists', 'existe'] },
  { op: 'is_false', label: ['does not exist', 'no existe'] },
]
const IN_OPS: ConditionFieldDef['ops'] = [
  { op: 'in', label: ['is', 'es'] },
  { op: 'not_in', label: ['is not', 'no es'] },
]

export const BRANCH_FIELDS: ConditionFieldDef[] = [
  { field: 'has_future_appointment', label: ['Future appointment', 'Cita futura'], ops: EXISTS_OPS, value: 'none', subject: 'patient' },
  {
    field: 'total_visits',
    label: ['Completed visits', 'Nº de visitas'],
    ops: [
      { op: 'gte', label: ['at least', 'al menos'] },
      { op: 'lte', label: ['at most', 'como mucho'] },
      { op: 'is', label: ['exactly', 'exactamente'] },
    ],
    value: 'number',
    subject: 'patient',
  },
  {
    field: 'tags',
    label: ['Tag', 'Etiqueta'],
    ops: [
      { op: 'contains', label: ['contains', 'contiene'] },
      { op: 'not_contains', label: ['does not contain', 'no contiene'] },
    ],
    value: 'text',
    subject: 'patient',
  },
  { field: 'balance_cents', label: ['Balance', 'Saldo'], ops: [{ op: 'balance', label: ['is', 'es'] }], value: 'balance', subject: 'patient' },
  { field: 'membership_active', label: ['Active membership', 'Membresía activa'], ops: BOOL_OPS, value: 'none', subject: 'patient' },
  { field: 'appointment_type_id', label: ['Appointment type', 'Tipo de cita'], ops: IN_OPS, value: 'multi', options: 'appointment_types', subject: 'patient', appointment: true },
  { field: 'practitioner_id', label: ['Practitioner', 'Profesional'], ops: IN_OPS, value: 'multi', options: 'practitioners', subject: 'patient', appointment: true },
  {
    field: 'marketing_channels',
    label: ['Marketing consent', 'Consentimiento de marketing'],
    ops: [
      { op: 'is', label: ['accepted', 'aceptó'] },
      { op: 'is_not', label: ['did not accept', 'no aceptó'] },
    ],
    value: 'channel',
    subject: 'patient',
  },
  {
    field: 'doc_answer',
    label: ['Form answer', 'Respuesta de un formulario'],
    ops: [
      { op: 'gte', label: ['at least', 'al menos'] },
      { op: 'lte', label: ['at most', 'como mucho'] },
      { op: 'is', label: ['is', 'es'] },
      { op: 'contains', label: ['contains', 'contiene'] },
    ],
    value: 'doc_answer',
    subject: 'patient',
  },
  { field: 'replied_since_start', label: ['Replied on WhatsApp', 'Respondió por WhatsApp'], ops: BOOL_OPS, value: 'none' },
  { field: 'email_opened_since_start', label: ['Opened the email', 'Abrió el email'], ops: BOOL_OPS, value: 'none' },
  { field: 'email_clicked_since_start', label: ['Clicked the email', 'Hizo clic en el email'], ops: BOOL_OPS, value: 'none' },
  { field: 'has_email', label: ['Has an email address', 'Tiene email'], ops: BOOL_OPS, value: 'none' },
  { field: 'has_phone', label: ['Has a phone number', 'Tiene teléfono'], ops: BOOL_OPS, value: 'none' },
  { field: 'lead_stage', label: ['Lead stage', 'Etapa del lead'], ops: IN_OPS, value: 'multi', options: 'lead_stages', subject: 'lead' },
  { field: 'lead_channel', label: ['Lead channel', 'Canal del lead'], ops: IN_OPS, value: 'multi', options: 'lead_channels', subject: 'lead' },
  {
    field: 'lead_source',
    label: ['Lead source', 'Origen del lead'],
    ops: [
      { op: 'contains', label: ['contains', 'contiene'] },
      { op: 'is', label: ['is', 'es'] },
    ],
    value: 'text',
    subject: 'lead',
  },
]
export const conditionFieldDef = (field: string) => BRANCH_FIELDS.find((f) => f.field === field) ?? null

/** Ops that compare against nothing. */
export const VALUELESS_OPS = ['is_true', 'is_false']

export const BALANCE_OPTIONS: { value: string; op: string; cents: number; label: Pair }[] = [
  { value: 'owes', op: 'lt', cents: 0, label: ['owes money', 'debe dinero'] },
  { value: 'credit', op: 'gt', cents: 0, label: ['is in credit', 'tiene saldo a favor'] },
  { value: 'zero', op: 'is', cents: 0, label: ['is settled', 'está al día'] },
]

export const CONSENT_CHANNEL_OPTIONS: { value: string; label: Pair }[] = [
  { value: 'whatsapp', label: ['WhatsApp', 'WhatsApp'] },
  { value: 'email', label: ['Email', 'Email'] },
  { value: 'sms', label: ['SMS', 'SMS'] },
]

// ------------------------------------------------------------------ trigger filters

export type FilterKey =
  | 'appointment_types'
  | 'practitioners'
  | 'total_visits'
  | 'no_prior_appointments'
  | 'has_future_appointment'
  | 'tag_contains'
  | 'balance'
  | 'membership'
  | 'last_visit'
  | 'last_visit_within'
  | 'min_visits'
  | 'max_visits'
  | 'no_whatsapp_sent'
  | 'care_plan_overdue'
  | 'clinics'

export interface FilterDef {
  key: FilterKey
  label: Pair
  /** Only with an appointment in scope. */
  appointment?: boolean
  /** Not offered on a segment (its patients have no appointment). */
  segment?: boolean
}

// Exactly the filter set evaluateAutomationFilters understands (plus the two
// it gained for segments, last_visit and clinics). "Solo si" in the trigger
// panel writes these keys into automation_rules.filters, the way the old
// editor did, so a rule saved here and a rule saved there read the same.
export const FILTERS: FilterDef[] = [
  { key: 'appointment_types', label: ['Appointment type', 'Tipo de cita'], appointment: true },
  { key: 'practitioners', label: ['Practitioner', 'Profesional'], appointment: true },
  { key: 'total_visits', label: ['Completed visits', 'Nº de visitas'], segment: true },
  { key: 'no_prior_appointments', label: ['First-time patient', 'Paciente nuevo'], appointment: true },
  { key: 'has_future_appointment', label: ['Future appointment', 'Cita futura'], segment: true },
  { key: 'last_visit', label: ['Last visit', 'Última visita'], segment: true },
  // The other edge of a band, and a visit-count range: what a recall needs to
  // tell "one visit, three weeks to four months ago" from "two or more, six
  // months to a year" (utils/automationAudience.ts).
  { key: 'last_visit_within', label: ['Last visit no earlier than', 'Última visita como mucho hace'], segment: true },
  { key: 'min_visits', label: ['At least N visits', 'Mínimo de visitas'], segment: true },
  { key: 'max_visits', label: ['At most N visits', 'Máximo de visitas'], segment: true },
  { key: 'no_whatsapp_sent', label: ['No WhatsApp sent recently', 'Sin WhatsApp reciente'], segment: true },
  { key: 'care_plan_overdue', label: ['Behind on their care plan', 'Retrasado en su plan'], segment: true },
  { key: 'tag_contains', label: ['Tag', 'Etiqueta'], segment: true },
  { key: 'balance', label: ['Balance', 'Saldo'], segment: true },
  { key: 'membership', label: ['Membership', 'Membresía'], segment: true },
  { key: 'clinics', label: ['Location', 'Sede'], segment: true },
]

/** Which filters a rule's stored filters object currently uses, in display order. */
export function filtersInUse(filters: Record<string, unknown> | null | undefined): FilterKey[] {
  const f = filters ?? {}
  const used: FilterKey[] = []
  const has = (k: string) => f[k] !== undefined && f[k] !== null
  if ((Array.isArray(f.appointment_type_ids) && f.appointment_type_ids.length) || typeof f.appointment_type_id === 'string') used.push('appointment_types')
  if (Array.isArray(f.practitioner_ids) && f.practitioner_ids.length) used.push('practitioners')
  if (has('total_visits')) used.push('total_visits')
  if (f.no_prior_appointments === true) used.push('no_prior_appointments')
  if (has('has_future_appointment')) used.push('has_future_appointment')
  if (has('last_visit_before_days')) used.push('last_visit')
  if (has('last_visit_within_days')) used.push('last_visit_within')
  if (has('min_visits')) used.push('min_visits')
  if (has('max_visits')) used.push('max_visits')
  if (has('no_whatsapp_sent_days')) used.push('no_whatsapp_sent')
  if (has('care_plan_overdue_days')) used.push('care_plan_overdue')
  // Present, even while still empty: a row just added has to stay on screen.
  if (typeof f.tag_contains === 'string') used.push('tag_contains')
  if (f.balance === 'debit' || f.balance === 'credit') used.push('balance')
  if (f.membership_active === true || (Array.isArray(f.membership_ids) && f.membership_ids.length)) used.push('membership')
  if (Array.isArray(f.clinic_ids) && f.clinic_ids.length) used.push('clinics')
  return used
}

/** The stored keys a filter owns, so removing it removes exactly those. */
export const FILTER_KEYS: Record<FilterKey, string[]> = {
  appointment_types: ['appointment_type_ids', 'appointment_type_id'],
  practitioners: ['practitioner_ids'],
  total_visits: ['total_visits'],
  no_prior_appointments: ['no_prior_appointments'],
  has_future_appointment: ['has_future_appointment'],
  last_visit: ['last_visit_before_days'],
  last_visit_within: ['last_visit_within_days'],
  min_visits: ['min_visits'],
  max_visits: ['max_visits'],
  no_whatsapp_sent: ['no_whatsapp_sent_days'],
  care_plan_overdue: ['care_plan_overdue_days'],
  tag_contains: ['tag_contains'],
  balance: ['balance'],
  membership: ['membership_active', 'membership_ids'],
  clinics: ['clinic_ids'],
}

/** A filter's starting value when added. */
export function defaultFilterValue(key: FilterKey): Record<string, unknown> {
  switch (key) {
    case 'appointment_types':
      return { appointment_type_ids: [] }
    case 'practitioners':
      return { practitioner_ids: [] }
    case 'total_visits':
      return { total_visits: 1 }
    case 'no_prior_appointments':
      return { no_prior_appointments: true }
    case 'has_future_appointment':
      return { has_future_appointment: false }
    case 'last_visit':
      return { last_visit_before_days: 180 }
    case 'last_visit_within':
      return { last_visit_within_days: 365 }
    case 'min_visits':
      return { min_visits: 2 }
    case 'max_visits':
      return { max_visits: 1 }
    case 'no_whatsapp_sent':
      return { no_whatsapp_sent_days: 30 }
    case 'care_plan_overdue':
      return { care_plan_overdue_days: 7 }
    case 'tag_contains':
      return { tag_contains: '' }
    case 'balance':
      return { balance: 'debit' }
    case 'membership':
      return { membership_active: true }
    case 'clinics':
      return { clinic_ids: [] }
  }
}

// ------------------------------------------------------------------ WhatsApp variables

export const VARIABLE_SOURCES: { value: string; label: Pair }[] = [
  { value: 'first_name', label: ['First name', 'Nombre del paciente'] },
  { value: 'last_name', label: ['Last name', 'Apellidos'] },
  { value: 'email', label: ['Email', 'Email'] },
  { value: 'next_appointment', label: ['Appointment date & time', 'Fecha y hora de la cita'] },
  { value: 'appointment_date', label: ['Appointment date', 'Fecha de la cita'] },
  { value: 'appointment_time', label: ['Appointment time', 'Hora de la cita'] },
  { value: 'google_review_link', label: ['Google review link', 'Enlace de reseña de Google'] },
  { value: 'satisfaction_link', label: ['Satisfaction question link', 'Enlace para valorar la visita'] },
  { value: 'waitlist_claim_link', label: ['Waitlist claim link', 'Enlace para reservar el hueco'] },
  { value: 'waitlist_slot_datetime', label: ['Offered slot date & time', 'Fecha y hora del hueco ofrecido'] },
  { value: 'invoice_number', label: ['Invoice number', 'Número de factura'] },
  { value: 'invoice_amount_owed', label: ['Amount owed', 'Importe pendiente'] },
  { value: 'invoice_pay_link', label: ['Payment link (card)', 'Enlace de pago (tarjeta)'] },
  { value: 'booking_link', label: ['Online booking link', 'Enlace de reserva online'] },
  { value: 'clinic_name', label: ['Clinic name', 'Nombre de la clínica'] },
  { value: 'clinic_phone', label: ['Clinic phone', 'Teléfono de la clínica'] },
  { value: 'clinic_address', label: ['Clinic address', 'Dirección de la clínica'] },
  // A recall reads better from "Léa" than from "the clinic". The clinic's
  // name when the patient has no practitioner, so Meta never gets an empty
  // parameter (it refuses the whole message over one).
  { value: 'practitioner_first_name', label: ["Their practitioner's first name", 'Nombre de su profesional'] },
  { value: 'last_visit_month', label: ['Month of their last visit', 'Mes de su última visita'] },
  { value: 'text', label: ['Fixed text', 'Texto fijo'] },
]

/** What a dynamic URL button's parameter can be (runAutomationActions: buttonParamValue). */
export const BUTTON_PARAM_SOURCES: { value: string; label: Pair }[] = [
  { value: '', label: ["Default (name and id)", 'Por defecto (nombre e id)'] },
  { value: 'doc', label: ['A document to sign or fill', 'Un documento para firmar o rellenar'] },
  { value: 'phone', label: ['Their phone number', 'Su teléfono'] },
  { value: 'first_name', label: ['First name', 'Nombre'] },
  { value: 'text', label: ['Fixed text', 'Texto fijo'] },
]

/** Merge fields an email can use, inserted as {{key}}. */
export const EMAIL_MERGE_FIELDS = VARIABLE_SOURCES.filter((v) => v.value !== 'text')

// ------------------------------------------------------------------ runs

/** Why a run ended early (automation_sequence_runs.stopped_reason), in words. */
export const STOP_REASONS: Record<string, Pair> = {
  converted: ['Became a patient', 'Se hizo paciente'],
  already_a_patient: ['Already a patient', 'Ya era paciente'],
  lead_deleted: ['The lead was deleted', 'Se borró el lead'],
  lost: ['The lead was marked lost', 'El lead se marcó como perdido'],
  no_contact: ['No phone or email', 'Sin teléfono ni email'],
  rule_shortened: ['The automation was shortened past where they were', 'La automatización se acortó por detrás de donde estaba'],
  not_entitled: ['Growth is no longer on the subscription', 'Growth ya no está en la suscripción'],
  patient_deleted: ['The patient record was deleted', 'Se borró su ficha'],
  exited: ['Left when an exit event happened', 'Salió al ocurrir un evento de salida'],
  taken_out: ['Taken out by someone on the team', 'Lo sacó alguien del equipo'],
  step_removed: ['The step they were on was removed', 'Se quitó el paso en el que estaba'],
  appointment_deleted: ['The appointment was deleted', 'Se eliminó la cita'],
  appointment_cancelled: ['The appointment was cancelled', 'Se canceló la cita'],
  appointment_answered: ['They already confirmed or asked to change the appointment', 'Ya confirmó o pidió cambiar la cita'],
  declined: ['Asked not to be contacted (WhatsApp reply)', 'Pidió que no le contactemos (respuesta por WhatsApp)'],
  snoozed: ['Asked to be written to later (WhatsApp reply)', 'Pidió que le escribamos más adelante (respuesta por WhatsApp)'],
}

/** A run history row's outcome, in words. */
export const OUTCOMES: Record<string, Pair> = {
  started: ['Entered', 'Entró'],
  sent: ['Sent', 'Enviado'],
  dry_run: ['Test mode · not sent', 'Prueba · no enviado'],
  skipped: ['Skipped', 'Omitido'],
  failed: ['Failed', 'Falló'],
  waiting: ['Waiting', 'Esperando'],
  deferred: ['Deferred', 'Aplazado'],
  stopped: ['Left', 'Salió'],
  finished: ['Finished', 'Terminó'],
  retried: ['Retried', 'Reintentado'],
  branched: ['Condition', 'Condición'],
  met: ['It happened', 'Ocurrió'],
  timed_out: ['Time ran out', 'Se acabó el tiempo'],
  applied: ['Done', 'Hecho'],
  // Message rows (History tab)
  would_send: ['Test mode · not sent', 'Prueba · no enviado'],
  delivered: ['Delivered', 'Entregado'],
  read: ['Read', 'Leído'],
  opened: ['Opened', 'Abierto'],
  clicked: ['Clicked', 'Clic'],
  bounced: ['Bounced', 'Rebotado'],
}

// ------------------------------------------------------------------ leads

export const LEAD_STAGE_OPTIONS: { value: string; label: Pair }[] = [
  { value: 'new', label: ['New', 'Nuevo'] },
  { value: 'contacted', label: ['Contacted', 'Contactado'] },
  { value: 'qualified', label: ['Qualified', 'Cualificado'] },
  { value: 'booked', label: ['Booked', 'Con cita'] },
  { value: 'showed', label: ['Showed', 'Vino'] },
  { value: 'converted', label: ['Patient', 'Paciente'] },
  { value: 'lost', label: ['Lost', 'Perdido'] },
]

export const LEAD_CHANNEL_OPTIONS: { value: string; label: Pair }[] = [
  { value: 'whatsapp', label: ['WhatsApp', 'WhatsApp'] },
  { value: 'sms', label: ['SMS', 'SMS'] },
  { value: 'phone', label: ['Phone', 'Teléfono'] },
  { value: 'web', label: ['Web', 'Web'] },
  { value: 'instagram', label: ['Instagram', 'Instagram'] },
  { value: 'facebook', label: ['Facebook', 'Facebook'] },
  { value: 'walk_in', label: ['Walk-in', 'En persona'] },
]
