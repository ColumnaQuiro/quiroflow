// What starts an automation, as a few broad atoms rather than one trigger per
// case: a SUBJECT (an appointment, a patient, a bono...), a MOMENT of it (is
// booked, its start, their birthday...) and, where it makes sense, a TIMING
// (24 hours before the start, 2 days after the end). Everything narrower --
// which appointment type, only completed visits, only the first visit -- is
// an "only if" filter on top (server/utils/evaluateAutomationFilters.ts).
//
// Stored in automation_rules.trigger (20261124120000_automation_trigger_atoms.sql).
// The older automation_rules.trigger_event + the trigger settings mixed into
// filters are what the code before this change reads; they are kept written
// for as long as that code can still be live (a rollback), and
// `atomFromLegacy` / `legacyFromAtom` translate between the two. The SQL
// function automation_trigger_from_legacy() is the same mapping, for the
// backfill and for rules the old code still saves; tests/unit/
// automation-trigger-atoms.test.ts pins every legacy trigger to its atom.
//
// Pure data and pure helpers: imported by pages, components, server routes
// and tests alike.

export type TriggerPair = readonly [en: string, es: string]

export type TriggerSubject =
  | 'appointment'
  | 'patient'
  | 'care_plan'
  | 'bono'
  | 'membership'
  | 'invoice'
  | 'form'
  | 'rating'
  | 'referral'
  | 'waitlist'
  | 'lead'
  | 'group'

export type TimingUnit = 'minutes' | 'hours' | 'days'
export type TimingDirection = 'before' | 'after'

export interface TriggerTiming {
  amount: number
  unit: TimingUnit
  direction: TimingDirection
  /** HH:MM, clinic time: only with days, and only where the moment offers it (an appointment's start). */
  at?: string | null
}

export interface TriggerAtom {
  subject: TriggerSubject
  moment: string
  /** Null: the moment it happens. */
  timing: TriggerTiming | null
  /** The moment's own setting: which tag, which form, which lead stage... */
  options: Record<string, unknown>
  /** Who the automation is for, when it is not the patient the moment is about. */
  send_to?: 'referrer' | null
}

/**
 * How a moment treats a timing:
 *  - 'event': it happens now; a timing "after" holds the automation back that
 *    long (the run starts with a wait, and the filters are asked again when
 *    it ends);
 *  - 'date': a date on the record, read by the 15-minute check; a timing is
 *    required, before and/or after;
 *  - 'both': no timing is the event, as it happens; a timing counts from the
 *    date it left on the record, read by the 15-minute check.
 */
export type MomentKind = 'event' | 'date' | 'both'

export interface MomentDef {
  subject: TriggerSubject
  moment: string
  /** Completes the subject's sentence: "An appointment" + "is booked". */
  label: TriggerPair
  hint: TriggerPair
  kind: MomentKind
  /** For 'date' and 'both' with a timing: which directions make sense. */
  directions?: TimingDirection[]
  /** For 'date' and 'both' with a timing: which units. */
  units?: TimingUnit[]
  /** Whether "days before/after, at HH:MM" is offered. */
  allowsAt?: boolean
  /** An appointment is in scope, so appointment-type / practitioner filters apply. */
  appointmentContext: boolean
  /** Found by the 15-minute check rather than raised where it happens. */
  scanned?: boolean
  growth?: boolean
}

export interface SubjectDef {
  subject: TriggerSubject
  label: TriggerPair
  growth?: boolean
}

export const TRIGGER_SUBJECTS: SubjectDef[] = [
  { subject: 'appointment', label: ['Appointment', 'Cita'] },
  { subject: 'patient', label: ['Patient', 'Paciente'] },
  { subject: 'care_plan', label: ['Care plan', 'Plan de cuidado'] },
  { subject: 'bono', label: ['Bono', 'Bono'] },
  { subject: 'membership', label: ['Membership', 'Membresía'] },
  { subject: 'invoice', label: ['Invoice', 'Factura'] },
  { subject: 'form', label: ['Form', 'Formulario'] },
  { subject: 'rating', label: ['Satisfaction rating', 'Valoración'] },
  { subject: 'referral', label: ['Referral', 'Referido'] },
  { subject: 'waitlist', label: ['Waitlist', 'Lista de espera'] },
  { subject: 'lead', label: ['Lead', 'Lead'], growth: true },
]

const MINUTES_HOURS_DAYS: TimingUnit[] = ['minutes', 'hours', 'days']
const DAYS: TimingUnit[] = ['days']

export const TRIGGER_MOMENTS: MomentDef[] = [
  // ---- appointment
  { subject: 'appointment', moment: 'booked', label: ['Is booked', 'Se reserva'], hint: ['As soon as it is booked, by the team, online or in the app.', 'En cuanto se reserva, desde recepción, online o en la app.'], kind: 'event', appointmentContext: true },
  { subject: 'appointment', moment: 'rescheduled', label: ['Moves to another time', 'Cambia de fecha u hora'], hint: ['When its date or time changes.', 'Cuando cambia su fecha o su hora.'], kind: 'event', appointmentContext: true },
  { subject: 'appointment', moment: 'cancelled', label: ['Is cancelled', 'Se cancela'], hint: ['When it is cancelled.', 'Cuando se cancela.'], kind: 'event', appointmentContext: true },
  { subject: 'appointment', moment: 'no_show', label: ['Is marked as missed', 'Se marca como no asistida'], hint: ['When it is marked as a missed visit.', 'Cuando se marca como no asistida.'], kind: 'event', appointmentContext: true },
  { subject: 'appointment', moment: 'checked_in', label: ['Is checked in', 'Tiene check-in'], hint: ['The moment the front desk checks the patient in.', 'En el momento en que recepción registra la llegada.'], kind: 'event', appointmentContext: true },
  { subject: 'appointment', moment: 'completed', label: ['Is completed', 'Se completa'], hint: ['Right after the visit is marked completed or checked out.', 'Justo después de marcar la visita como completada o cobrada.'], kind: 'event', appointmentContext: true },
  {
    subject: 'appointment',
    moment: 'start',
    label: ['Starts', 'Empieza'],
    hint: ['Counted from the time it starts. Checked every 15 minutes; once per appointment.', 'Contando desde la hora de inicio. Se comprueba cada 15 minutos; una vez por cita.'],
    kind: 'date',
    directions: ['before', 'after'],
    units: MINUTES_HOURS_DAYS,
    allowsAt: true,
    appointmentContext: true,
    scanned: true,
  },
  {
    subject: 'appointment',
    moment: 'end',
    label: ['Ends', 'Termina'],
    hint: ['Counted from the time it ends. Checked every 15 minutes; once per appointment.', 'Contando desde la hora de fin. Se comprueba cada 15 minutos; una vez por cita.'],
    kind: 'date',
    directions: ['after'],
    units: MINUTES_HOURS_DAYS,
    appointmentContext: true,
    scanned: true,
  },
  // ---- patient
  { subject: 'patient', moment: 'created', label: ['Is added', 'Se da de alta'], hint: ['A new patient record, by the team, online booking or the app. Imported patients do not count. Checked every 15 minutes.', 'Una ficha nueva, desde recepción, la reserva online o la app. Los importados no cuentan. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: false, scanned: true },
  { subject: 'patient', moment: 'tag_added', label: ['Is given a tag', 'Recibe una etiqueta'], hint: ['When someone on the team, or an automation, adds the tag.', 'Cuando alguien del equipo, o una automatización, añade la etiqueta.'], kind: 'event', appointmentContext: false },
  { subject: 'patient', moment: 'tag_removed', label: ['Loses a tag', 'Pierde una etiqueta'], hint: ['When someone on the team, or an automation, removes the tag.', 'Cuando alguien del equipo, o una automatización, quita la etiqueta.'], kind: 'event', appointmentContext: false },
  { subject: 'patient', moment: 'type_added', label: ['Is given a patient type', 'Recibe un tipo de paciente'], hint: ["Settings > Patient types. Use it to send that type's forms or welcome.", 'Ajustes › Tipos de paciente. Sirve para enviar los formularios o la bienvenida de ese tipo.'], kind: 'event', appointmentContext: false },
  { subject: 'patient', moment: 'type_removed', label: ['Loses a patient type', 'Pierde un tipo de paciente'], hint: ["When the type is taken off the patient's record.", 'Cuando se quita el tipo de la ficha.'], kind: 'event', appointmentContext: false },
  { subject: 'patient', moment: 'entered_audience', label: ['Enters a list or segment', 'Entra en una lista o segmento'], hint: ['When someone is added to the list, or starts matching the segment (checked every 15 minutes).', 'Cuando alguien se añade a la lista, o empieza a cumplir el segmento (se comprueba cada 15 minutos).'], kind: 'event', appointmentContext: false, scanned: true },
  { subject: 'patient', moment: 'birthday', label: ['Has a birthday', 'Cumple años'], hint: ["Their date of birth, in the clinic's day. Checked once a day.", 'Su fecha de nacimiento, en el día de la clínica. Se comprueba una vez al día.'], kind: 'date', directions: ['before', 'after'], units: DAYS, appointmentContext: false, scanned: true },
  { subject: 'patient', moment: 'date_field', label: ['Reaches a date on their record', 'Llega a una fecha de su ficha'], hint: ['A date field of your own (a due date, an operation). Each day from 9:00.', 'Un campo de fecha propio (una fecha de parto, una operación). Cada día desde las 9:00.'], kind: 'date', directions: ['before', 'after'], units: DAYS, appointmentContext: false, scanned: true },
  { subject: 'patient', moment: 'last_visit', label: ['Has not been back since a visit', 'No ha vuelto desde una visita'], hint: ['Counted from their last completed visit, only while it is still their last. Each day from 9:00.', 'Contando desde su última visita completada, solo mientras siga siendo la última. Cada día desde las 9:00.'], kind: 'date', directions: ['after'], units: DAYS, appointmentContext: false, scanned: true },
  // ---- care plan
  { subject: 'care_plan', moment: 'created', label: ['Is created', 'Se crea'], hint: ['A new care plan for the patient. Checked every 15 minutes.', 'Un plan de cuidado nuevo para el paciente. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: false, scanned: true },
  { subject: 'care_plan', moment: 'milestone', label: ['Reaches a milestone', 'Llega a un hito'], hint: ['After a completed visit: the next is a re-exam, it was the last of the plan, or visit number N. Checked every 15 minutes.', 'Tras una visita completada: la siguiente es una revisión, era la última del plan, o la visita número N. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: true, scanned: true },
  { subject: 'care_plan', moment: 'started', label: ['Started', 'Empezó'], hint: ["Counted from the plan's start date. Each day from 9:00.", 'Contando desde la fecha de inicio del plan. Cada día desde las 9:00.'], kind: 'date', directions: ['after'], units: DAYS, appointmentContext: false, scanned: true },
  // ---- bono
  { subject: 'bono', moment: 'bought', label: ['Is bought', 'Se compra'], hint: ['A bono sold to the patient. Imported ones do not count. Checked every 15 minutes.', 'Un bono vendido al paciente. Los importados no cuentan. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: false, scanned: true },
  { subject: 'bono', moment: 'running_low', label: ['Is running low', 'Se está acabando'], hint: ['When a session used leaves it with that many or fewer, once per bono. Checked every 15 minutes.', 'Cuando una sesión usada lo deja con esas o menos, una vez por bono. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: false, scanned: true },
  // ---- membership
  { subject: 'membership', moment: 'started', label: ['Starts', 'Empieza'], hint: ['When a patient starts one. With a timing, counted from its start date, each day from 9:00.', 'Cuando un paciente empieza una. Con un plazo, contando desde su fecha de inicio, cada día desde las 9:00.'], kind: 'both', directions: ['after'], units: DAYS, appointmentContext: false },
  { subject: 'membership', moment: 'cancelled', label: ['Is cancelled', 'Se cancela'], hint: ["When a patient's membership is cancelled.", 'Cuando se cancela la membresía de un paciente.'], kind: 'event', appointmentContext: false },
  { subject: 'membership', moment: 'charged', label: ['Is charged', 'Se cobra'], hint: ['Each time a recurring charge succeeds.', 'Cada vez que se cobra una cuota.'], kind: 'event', appointmentContext: false },
  // ---- invoice
  { subject: 'invoice', moment: 'issued', label: ['Is issued', 'Se emite'], hint: ['When it is raised (imports do not count; checked every 15 minutes). With a timing, counted from that day: add "Still unpaid" for a payment reminder.', 'Cuando se emite (las importadas no cuentan; se comprueba cada 15 minutos). Con un plazo, contando desde ese día: añade «Sin pagar» para un recordatorio de pago.'], kind: 'both', directions: ['after'], units: DAYS, appointmentContext: false, scanned: true },
  { subject: 'invoice', moment: 'paid', label: ['Is paid', 'Se paga'], hint: ['Once it is paid in full.', 'Cuando se paga por completo.'], kind: 'event', appointmentContext: true },
  // ---- form
  { subject: 'form', moment: 'sent', label: ['Is sent', 'Se envía'], hint: ['A form or consent given to the patient to fill in. Imported ones do not count. Checked every 15 minutes.', 'Un formulario o consentimiento dado al paciente para rellenar. Los importados no cuentan. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: false, scanned: true },
  { subject: 'form', moment: 'completed', label: ['Is completed', 'Se completa'], hint: ['By the patient or the team. Checked every 15 minutes.', 'Por el paciente o el equipo. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: false, scanned: true },
  // ---- rating
  { subject: 'rating', moment: 'answered', label: ['Is given', 'Se recibe'], hint: ['When a patient answers the satisfaction question. Their first answer only.', 'Cuando un paciente contesta la pregunta de satisfacción. Solo su primera respuesta.'], kind: 'event', appointmentContext: true },
  // ---- referral
  { subject: 'referral', moment: 'referred', label: ['Is recorded', 'Se registra'], hint: ['For the patient who referred someone, as soon as they are linked as the referrer.', 'Para quien refirió, en cuanto se le vincula como referente.'], kind: 'event', appointmentContext: false },
  // ---- waitlist
  { subject: 'waitlist', moment: 'joined', label: ['Gets someone new', 'Recibe a alguien'], hint: ['A patient is added to the waitlist. Checked every 15 minutes.', 'Se añade un paciente a la lista de espera. Se comprueba cada 15 minutos.'], kind: 'event', appointmentContext: false, scanned: true },
  { subject: 'waitlist', moment: 'slot_offered', label: ['Offers a freed slot', 'Ofrece un hueco libre'], hint: ['When a cancelled appointment is offered to the next patient on it.', 'Cuando una cita cancelada se ofrece al siguiente paciente.'], kind: 'event', appointmentContext: false },
  // ---- lead
  { subject: 'lead', moment: 'created', label: ['Arrives', 'Llega'], hint: ['From Meta Ads, the web form or the public API.', 'De Meta Ads, del formulario web o de la API pública.'], kind: 'event', appointmentContext: false, growth: true },
  { subject: 'lead', moment: 'stage_changed', label: ['Is moved to a stage', 'Se mueve de etapa'], hint: ['When the team or an automation moves it. Not when a booking moves it on its own.', 'Cuando el equipo o una automatización lo mueve. No cuando lo mueve sola una reserva.'], kind: 'event', appointmentContext: false, growth: true },
  // ---- a group send: chosen in its own place, not in the When picker.
  { subject: 'group', moment: 'scheduled', label: ['Is sent', 'Se envía'], hint: ['Everyone who matches, once or on a schedule.', 'Todos los que coinciden, una vez o con un horario.'], kind: 'event', appointmentContext: false },
]

export const momentDef = (subject: string | null | undefined, moment: string | null | undefined): MomentDef | null =>
  TRIGGER_MOMENTS.find((m) => m.subject === subject && m.moment === moment) ?? null

export const subjectDef = (subject: string | null | undefined): SubjectDef | null => TRIGGER_SUBJECTS.find((s) => s.subject === subject) ?? null

export const momentsOf = (subject: string): MomentDef[] => TRIGGER_MOMENTS.filter((m) => m.subject === subject)

export const isGroupAtom = (a: Pick<TriggerAtom, 'subject'> | null | undefined) => a?.subject === 'group'
export const isLeadAtom = (a: Pick<TriggerAtom, 'subject'> | null | undefined) => a?.subject === 'lead'

/** Why an atom cannot run: a moment that does not exist, or a timing it does not allow. Null when it is fine. */
export function atomProblem(a: TriggerAtom | null | undefined): TriggerPair | null {
  const def = momentDef(a?.subject, a?.moment)
  if (!a || !def) return ['Choose what starts the automation.', 'Elige qué inicia la automatización.']
  if (def.kind === 'date' && !a.timing) return ['Say how long before or after.', 'Indica cuánto antes o después.']
  if (a.timing) {
    const t = a.timing
    if (!Number.isFinite(t.amount) || t.amount < 0 || t.amount > 3650 * 1440 || !['minutes', 'hours', 'days'].includes(t.unit)) return ['The timing is not a valid number.', 'El plazo no es un número válido.']
    if (def.kind === 'event' && t.direction !== 'after') return ['This moment can only be followed, not anticipated.', 'Este momento solo se puede seguir, no anticipar.']
    if (def.kind !== 'event' && def.directions && !def.directions.includes(t.direction)) return ['This date can only be counted forward.', 'Esta fecha solo se puede contar hacia delante.']
    if (def.kind !== 'event' && def.units && !def.units.includes(t.unit)) return ['This date is counted in days.', 'Esta fecha se cuenta en días.']
    if (t.at && (!def.allowsAt || t.unit !== 'days' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.at))) return ['The time of day is not valid here.', 'La hora del día no es válida aquí.']
  }
  return null
}

// ------------------------------------------------------------------ timing

const UNIT_MINUTES: Record<TimingUnit, number> = { minutes: 1, hours: 60, days: 1440 }

/** The timing as signed minutes from the moment: negative before, positive after. */
export function timingMinutes(t: TriggerTiming | null | undefined): number {
  if (!t) return 0
  const m = Math.round(Number(t.amount) || 0) * UNIT_MINUTES[t.unit]
  return t.direction === 'before' ? -m : m
}

/** How long firing waits first: an event held back. Zero for every other atom. */
export function eventDelayMinutes(a: TriggerAtom): number {
  const def = momentDef(a.subject, a.moment)
  if (!def || def.kind !== 'event' || !a.timing) return 0
  return Math.max(0, timingMinutes(a.timing))
}

/** Whether the atom is read by a date scan, rather than raised as it happens. */
export function isDateAtom(a: TriggerAtom | null | undefined): boolean {
  const def = momentDef(a?.subject, a?.moment)
  if (!a || !def) return false
  return def.kind === 'date' || (def.kind === 'both' && !!a.timing)
}

/**
 * A reminder-like atom: it counts down to a visit, so its run ends if the
 * visit is cancelled, and steps that come due once it has begun are not sent
 * late (server/utils/automationEngine.ts).
 */
export function isUpcomingVisitAtom(a: TriggerAtom | null | undefined): boolean {
  return !!a && a.subject === 'appointment' && a.moment === 'start' && a.timing?.direction === 'before'
}

/** Campaign email (shares the daily budget, waits for a slot): a group send or a list/segment entry. */
export function isBulkAtom(a: TriggerAtom | null | undefined): boolean {
  return !!a && (a.subject === 'group' || (a.subject === 'patient' && a.moment === 'entered_audience'))
}

// ------------------------------------------------------------------ legacy

/** The "only if" keys the old timed triggers decided by themselves, which their atoms now say as filters. */
export const IMPLIED_FILTER_KEYS = ['appointment_statuses', 'reminder_unanswered', 'visit_number', 'not_rated_days', 'invoice_unpaid'] as const

/** The keys of the old trigger settings inside filters: kept written for the old code, never read as filters. */
export const LEGACY_TRIGGER_KEYS = [
  'hours_before',
  'skip_if_answered',
  'days_after',
  'hours_after',
  'first_visit',
  'every_visits',
  'days_overdue',
  'trigger_tag',
  'trigger_type_id',
  'trigger_type_name',
  'trigger_score',
  'trigger_doc_template_ids',
  'trigger_lead_stage',
  'trigger_milestone',
  'trigger_visit_number',
  'trigger_sessions_left',
  'trigger_audience',
  'include_current',
  'trigger_date',
  'trigger_days',
  'trigger_when',
] as const

type Filters = Record<string, unknown>

const plain = (v: unknown): v is Filters => !!v && typeof v === 'object' && !Array.isArray(v)
const positive = (v: unknown, fallback: number) => (Number(v) > 0 ? Number(v) : fallback)
/** Only the keys that hold something: undefined, null and '' are "not chosen". */
function pick(f: Filters, keys: string[]): Filters {
  const out: Filters = {}
  for (const k of keys) if (f[k] !== undefined && f[k] !== null && f[k] !== '') out[k] = f[k]
  return out
}

// Written "subject.moment" (not as pairs, which the interface-string scanner
// would take for English/Spanish).
const SAME_EVENT_KEYS: Record<string, string> = {
  'appointment.booked': 'appointment.booked',
  'appointment.rescheduled': 'appointment.rescheduled',
  'appointment.cancelled': 'appointment.cancelled',
  'appointment.no_show': 'appointment.no_show',
  'appointment.checked_in': 'appointment.checked_in',
  'appointment.completed': 'appointment.completed',
  'invoice.paid': 'invoice.paid',
  'patient.referred': 'referral.referred',
  'membership.new_member': 'membership.started',
  'membership.removed': 'membership.cancelled',
  'membership.payment_processed': 'membership.charged',
  'waitlist.slot_offered': 'waitlist.slot_offered',
  'lead.created': 'lead.created',
  segment: 'group.scheduled',
}
const SAME_EVENT: Record<string, [TriggerSubject, string]> = Object.fromEntries(
  Object.entries(SAME_EVENT_KEYS).map(([event, key]) => [event, key.split('.') as [TriggerSubject, string]]),
)

const OPTION_KEYS: Record<string, [TriggerSubject, string, string[]]> = {
  'patient.tag_added': ['patient', 'tag_added', ['trigger_tag']],
  'patient.tag_removed': ['patient', 'tag_removed', ['trigger_tag']],
  'patient.type_added': ['patient', 'type_added', ['trigger_type_id', 'trigger_type_name']],
  'patient.type_removed': ['patient', 'type_removed', ['trigger_type_id', 'trigger_type_name']],
  'satisfaction.answered': ['rating', 'answered', ['trigger_score']],
  'doc.completed': ['form', 'completed', ['trigger_doc_template_ids']],
  'care_plan.milestone': ['care_plan', 'milestone', ['trigger_milestone', 'trigger_visit_number']],
  'lead.stage_changed': ['lead', 'stage_changed', ['trigger_lead_stage']],
  'audience.entered': ['patient', 'entered_audience', ['trigger_audience', 'include_current']],
}

/** The days a "date on the record" rule counts, as the editor saved them: a whole number 0..3650, or 7 (its default) when there is none. */
function legacyDays(v: unknown): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : 7
}

/**
 * The atom an old trigger is, and the filters that make it behave exactly as
 * it did: what the old trigger decided by itself (only booked visits, only
 * those who have not answered a reminder...) becomes an "only if" filter,
 * merged into the rule's filters. Defaults are spelled out, so the rule does
 * not depend on what a default happens to be later.
 *
 * Mirrored in SQL by automation_trigger_from_legacy(); keep the two together.
 */
export function atomFromLegacy(event: string, rawFilters: unknown): { trigger: TriggerAtom; implied: Filters } {
  const f: Filters = plain(rawFilters) ? rawFilters : {}
  const atom = (subject: TriggerSubject, moment: string, timing: TriggerTiming | null = null, options: Filters = {}, sendTo: 'referrer' | null = null): TriggerAtom => ({
    subject,
    moment,
    timing,
    options,
    ...(sendTo ? { send_to: sendTo } : {}),
  })

  if (SAME_EVENT[event]) {
    const [s, m] = SAME_EVENT[event]
    return { trigger: atom(s, m), implied: {} }
  }
  if (OPTION_KEYS[event]) {
    const [s, m, keys] = OPTION_KEYS[event]
    return { trigger: atom(s, m, null, pick(f, keys)), implied: {} }
  }
  switch (event) {
    case 'appointment.hours_before':
      return {
        trigger: atom('appointment', 'start', { amount: positive(f.hours_before, 24), unit: 'hours', direction: 'before' }),
        implied: { appointment_statuses: ['booked'], ...(f.skip_if_answered !== false ? { reminder_unanswered: true } : {}) },
      }
    case 'appointment.same_day':
      return { trigger: atom('appointment', 'start', { amount: 0, unit: 'days', direction: 'before', at: '09:00' }), implied: { appointment_statuses: ['booked'] } }
    case 'appointment.review_request':
      return { trigger: atom('appointment', 'end', { amount: positive(f.days_after, 2), unit: 'days', direction: 'after' }), implied: { appointment_statuses: ['completed'] } }
    case 'appointment.satisfaction':
      return {
        trigger: atom('appointment', 'end', { amount: positive(f.hours_after, 2), unit: 'hours', direction: 'after' }),
        implied: {
          appointment_statuses: ['completed'],
          visit_number: { first: f.first_visit !== false, every: f.every_visits === undefined ? 10 : Math.max(0, Number(f.every_visits) || 0) },
          not_rated_days: 30,
        },
      }
    case 'invoice.overdue':
      return { trigger: atom('invoice', 'issued', { amount: Number(f.days_overdue) || 7, unit: 'days', direction: 'after' }), implied: { invoice_unpaid: true } }
    case 'patient.birthday':
      return { trigger: atom('patient', 'birthday', { amount: 0, unit: 'days', direction: 'after' }), implied: {} }
    case 'referral.visit_completed':
      return { trigger: atom('appointment', 'completed', null, {}, 'referrer'), implied: {} }
    case 'bono.running_low': {
      const n = Number(f.trigger_sessions_left)
      return { trigger: atom('bono', 'running_low', null, { trigger_sessions_left: Number.isInteger(n) && n >= 0 ? n : 1 }), implied: {} }
    }
    case 'patient.date': {
      const source = String(f.trigger_date ?? '')
      const days = legacyDays(f.trigger_days)
      const after: TriggerTiming = { amount: days, unit: 'days', direction: 'after' }
      if (source === 'last_visit') return { trigger: atom('patient', 'last_visit', after), implied: {} }
      if (source === 'membership_start') return { trigger: atom('membership', 'started', after), implied: {} }
      if (source === 'care_plan_start') return { trigger: atom('care_plan', 'started', after), implied: {} }
      // A date field, or nothing chosen yet (which never fired, and still will not: no field).
      const before = f.trigger_when === 'before' && source.startsWith('field:')
      return {
        trigger: atom('patient', 'date_field', { amount: days, unit: 'days', direction: before ? 'before' : 'after' }, source.startsWith('field:') ? { trigger_date: source } : {}),
        implied: {},
      }
    }
  }
  // Unknown: an atom that names nothing, which never fires -- as the old
  // engine did with a trigger it did not know.
  return { trigger: atom('group', `unknown:${event}`), implied: {} }
}

/**
 * The old trigger an atom still is, with the old settings to put in filters,
 * or null when only the atoms can say it (then trigger_event is 'atom', which
 * the old code never selects). The inverse of atomFromLegacy for every atom
 * that function produces.
 */
export function legacyFromAtom(a: TriggerAtom, filters: Filters = {}): { trigger_event: string; settings: Filters } | null {
  const t = a.timing
  const o = a.options ?? {}
  const statuses = Array.isArray(filters.appointment_statuses) ? (filters.appointment_statuses as string[]) : []
  const only = (s: string) => statuses.length === 1 && statuses[0] === s
  // The old triggers read any positive number (Number(x) > 0); the editor only writes whole ones.
  const positiveAmount = (n: number) => Number.isFinite(n) && n > 0
  if (a.send_to === 'referrer') {
    return a.subject === 'appointment' && a.moment === 'completed' && !t ? { trigger_event: 'referral.visit_completed', settings: {} } : null
  }
  for (const [event, [s, m]] of Object.entries(SAME_EVENT)) {
    if (a.subject === s && a.moment === m && !t) return { trigger_event: event, settings: {} }
  }
  for (const [event, [s, m, keys]] of Object.entries(OPTION_KEYS)) {
    if (a.subject === s && a.moment === m && !t) return { trigger_event: event, settings: pick(o, keys) }
  }
  if (a.subject === 'appointment' && a.moment === 'start' && t) {
    if (t.direction === 'before' && t.unit === 'hours' && !t.at && positiveAmount(t.amount) && only('booked')) {
      return { trigger_event: 'appointment.hours_before', settings: { hours_before: t.amount, skip_if_answered: filters.reminder_unanswered === true } }
    }
    if (t.direction === 'before' && t.unit === 'days' && t.amount === 0 && t.at === '09:00' && only('booked') && filters.reminder_unanswered !== true) {
      return { trigger_event: 'appointment.same_day', settings: {} }
    }
    return null
  }
  if (a.subject === 'appointment' && a.moment === 'end' && t && t.direction === 'after' && only('completed') && positiveAmount(t.amount)) {
    const vn = plain(filters.visit_number) ? filters.visit_number : null
    if (t.unit === 'days' && !vn && filters.not_rated_days === undefined) return { trigger_event: 'appointment.review_request', settings: { days_after: t.amount } }
    if (t.unit === 'hours' && vn && filters.not_rated_days === 30) {
      return { trigger_event: 'appointment.satisfaction', settings: { hours_after: t.amount, first_visit: vn.first !== false, every_visits: Math.max(0, Number(vn.every) || 0) } }
    }
    return null
  }
  if (a.subject === 'invoice' && a.moment === 'issued' && t && t.unit === 'days' && t.direction === 'after' && positiveAmount(t.amount) && filters.invoice_unpaid === true) {
    return { trigger_event: 'invoice.overdue', settings: { days_overdue: t.amount } }
  }
  if (a.subject === 'patient' && a.moment === 'birthday' && t && t.amount === 0) return { trigger_event: 'patient.birthday', settings: {} }
  if (a.subject === 'bono' && a.moment === 'running_low' && !t) return { trigger_event: 'bono.running_low', settings: pick(o, ['trigger_sessions_left']) }
  const days = t && t.unit === 'days' && Number.isInteger(t.amount) && t.amount >= 0 && t.amount <= 3650 ? t.amount : null
  if (days !== null && t!.direction === 'after') {
    if (a.subject === 'patient' && a.moment === 'last_visit') return { trigger_event: 'patient.date', settings: { trigger_date: 'last_visit', trigger_days: days } }
    if (a.subject === 'membership' && a.moment === 'started') return { trigger_event: 'patient.date', settings: { trigger_date: 'membership_start', trigger_days: days } }
    if (a.subject === 'care_plan' && a.moment === 'started') return { trigger_event: 'patient.date', settings: { trigger_date: 'care_plan_start', trigger_days: days } }
  }
  if (days !== null && a.subject === 'patient' && a.moment === 'date_field') {
    // No field chosen yet: the old trigger with no date, which never fired either.
    if (typeof o.trigger_date !== 'string') return { trigger_event: 'patient.date', settings: { trigger_days: days } }
    return { trigger_event: 'patient.date', settings: { trigger_date: o.trigger_date, trigger_days: days, ...(t!.direction === 'before' ? { trigger_when: 'before' } : {}) } }
  }
  return null
}

/** Filters with the old trigger settings taken out: what the "only if" editor shows and the engine reads. */
export function onlyIfFilters(filters: Filters | null | undefined): Filters {
  const out: Filters = { ...(filters ?? {}) }
  for (const k of LEGACY_TRIGGER_KEYS) delete out[k]
  return out
}

/**
 * The rule columns to save for an atom and its "only if" filters: the atom
 * itself, plus the old trigger_event and settings the old code reads (or
 * 'atom' when there are none).
 */
export function ruleColumnsForAtom(a: TriggerAtom, onlyIf: Filters): { trigger: TriggerAtom; trigger_event: string; filters: Filters } {
  const clean = onlyIfFilters(onlyIf)
  const legacy = legacyFromAtom(a, clean)
  return { trigger: a, trigger_event: legacy?.trigger_event ?? 'atom', filters: { ...clean, ...(legacy?.settings ?? {}) } }
}

/** Reads a stored atom defensively: anything malformed is null. */
export function asTriggerAtom(v: unknown): TriggerAtom | null {
  if (!plain(v) || typeof v.subject !== 'string' || typeof v.moment !== 'string') return null
  const raw = plain(v.timing) ? v.timing : null
  const timing: TriggerTiming | null = raw
    ? {
        amount: Number(raw.amount),
        unit: (['minutes', 'hours', 'days'].includes(String(raw.unit)) ? raw.unit : 'days') as TimingUnit,
        direction: raw.direction === 'before' ? 'before' : 'after',
        ...(typeof raw.at === 'string' && raw.at ? { at: raw.at } : {}),
      }
    : null
  return {
    subject: v.subject as TriggerSubject,
    moment: v.moment,
    timing,
    options: plain(v.options) ? v.options : {},
    ...(v.send_to === 'referrer' ? { send_to: 'referrer' as const } : {}),
  }
}

/** The atom of a rule row: its stored trigger, or what its old trigger_event is. */
export function ruleAtom(rule: { trigger?: unknown; trigger_event?: string | null; filters?: unknown }): TriggerAtom {
  return asTriggerAtom(rule.trigger) ?? atomFromLegacy(String(rule.trigger_event ?? ''), rule.filters).trigger
}

/**
 * The atom an event raised by the app is about -- the names the calendar, the
 * payment screens, the server and older app releases still raise. Null for
 * an event no atom answers to.
 */
export function atomOfRaisedEvent(event: string): { subject: TriggerSubject; moment: string; sendTo?: 'referrer' } | null {
  if (SAME_EVENT[event] && event !== 'segment') {
    const [subject, moment] = SAME_EVENT[event]
    return { subject, moment }
  }
  if (OPTION_KEYS[event]) {
    const [subject, moment] = OPTION_KEYS[event]
    return { subject, moment }
  }
  if (event === 'referral.visit_completed') return { subject: 'appointment', moment: 'completed', sendTo: 'referrer' }
  return null
}

/** A fresh atom for a moment: the timing it needs (or none), and no options. */
export function defaultAtom(subject: TriggerSubject, moment: string): TriggerAtom {
  const def = momentDef(subject, moment)
  let timing: TriggerTiming | null = null
  if (def?.kind === 'date') {
    if (subject === 'appointment' && moment === 'start') timing = { amount: 24, unit: 'hours', direction: 'before' }
    else if (subject === 'appointment' && moment === 'end') timing = { amount: 2, unit: 'days', direction: 'after' }
    else if (subject === 'patient' && moment === 'birthday') timing = { amount: 0, unit: 'days', direction: 'after' }
    else timing = { amount: 7, unit: 'days', direction: 'after' }
  }
  const options: Filters = subject === 'bono' && moment === 'running_low' ? { trigger_sessions_left: 1 } : {}
  return { subject, moment, timing, options }
}

/** The "only if" filters a new atom starts with: the appointments it is about, by status. */
export function defaultFiltersFor(a: TriggerAtom): Filters {
  if (a.subject === 'appointment' && a.moment === 'start') return { appointment_statuses: ['booked'] }
  if (a.subject === 'appointment' && a.moment === 'end') return { appointment_statuses: ['completed'] }
  if (a.subject === 'invoice' && a.moment === 'issued' && a.timing) return { invoice_unpaid: true }
  return {}
}

// ------------------------------------------------------------------ filters the atoms added

/** "Visit number": the first completed visit, and/or every Nth (0 = never). */
export interface VisitNumberFilter {
  first?: boolean
  every?: number
}

/** Whether the patient's nth completed visit (this one included) is one the filter asks about. */
export function visitNumberMatches(vn: VisitNumberFilter, n: number): boolean {
  const every = Math.max(0, Math.round(Number(vn.every) || 0))
  return (vn.first !== false && n === 1) || (every > 0 && n > 0 && n % every === 0)
}

/** Whole years between a YYYY-MM-DD date of birth and a day. Null without a usable date. */
export function ageInYears(dateOfBirth: string | null | undefined, on: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateOfBirth ?? ''))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let age = on.getUTCFullYear() - y
  if (on.getUTCMonth() + 1 < mo || (on.getUTCMonth() + 1 === mo && on.getUTCDate() < d)) age -= 1
  return age
}

/** Age between two edges, either of which may be absent. Nobody without a date of birth matches an age. */
export function ageMatches(dateOfBirth: string | null | undefined, min: number | undefined, max: number | undefined, on: Date): boolean {
  const age = ageInYears(dateOfBirth, on)
  if (age === null) return false
  if (typeof min === 'number' && age < min) return false
  if (typeof max === 'number' && age > max) return false
  return true
}
