// What a merge field in an automation resolves to: a WhatsApp template's
// {{n}} slot mapped to a source in the automation builder
// (components/automations/panels/WhatsAppPanel.vue), or a {{token}} in an automated
// email. Pure, so each value can be checked without sending anything.
//
// Appointment dates and times are written in the clinic's own time zone
// (clinics.timezone), and the clinic's name, phone and address are fields of
// their own, so a clinic's template can say how to reach that location.
export const DEFAULT_TIMEZONE = 'Europe/Madrid'

export interface MergeRecipient {
  firstName: string
  lastName: string | null
  email: string | null
}

export interface MergeContext {
  nextAppointmentAt?: string
  googleReviewUrl?: string
  waitlistClaimLink?: string
  waitlistSlotDatetime?: string
  clinicName?: string
  clinicPhone?: string
  clinicAddress?: string
  clinicTimezone?: string
  /**
   * What a lead answered on the form they came in through (a Meta lead ad's
   * questions, stored on lead_events as a 'qualification' event). Each one is
   * a variable of its own, keyed by answerKey(question).
   */
  leadAnswers?: LeadAnswer[]
}

export interface LeadAnswer {
  question: string
  answer: string
}

/**
 * Form answers are variables named after their question:
 * "¿Cuál sería el motivo de tu consulta?" is {{answer_cual_seria_el_motivo_de_tu_consulta}}.
 *
 * Only letters, digits and underscores, because an email's {{token}} is
 * matched with \w+ (runAutomationActions: mergePlain/mergeHtml) and has to
 * survive being typed or pasted. Accents are folded rather than dropped, so
 * the key still reads as the question; capped so a long question does not
 * make an unwieldy token.
 */
export const ANSWER_PREFIX = 'answer_'

export function answerKey(question: string): string {
  const slug = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 60)
    .replace(/^_+|_+$/g, '')
  return slug ? ANSWER_PREFIX + slug : ''
}

/** Every answer across a lead's form events, oldest first; a later answer to the same question wins. */
export function leadAnswersFromEvents(events: { body?: unknown }[]): LeadAnswer[] {
  const out: LeadAnswer[] = []
  for (const event of events) {
    const answers = (event.body as { answers?: unknown } | null)?.answers
    if (!Array.isArray(answers)) continue
    for (const a of answers) {
      if (a && typeof a.question === 'string' && typeof a.answer === 'string') out.push({ question: a.question, answer: a.answer })
    }
  }
  return out
}

export function automationFieldValue(recipient: MergeRecipient, source: string, context?: MergeContext): string {
  const timeZone = context?.clinicTimezone || DEFAULT_TIMEZONE
  if (source === 'first_name') return recipient.firstName ?? ''
  if (source === 'last_name') return recipient.lastName ?? ''
  if (source === 'email') return recipient.email ?? ''
  if (source === 'google_review_link') return context?.googleReviewUrl ?? ''
  if (source === 'waitlist_claim_link') return context?.waitlistClaimLink ?? ''
  if (source === 'waitlist_slot_datetime') return context?.waitlistSlotDatetime ?? ''
  if (source === 'clinic_name') return context?.clinicName ?? ''
  if (source === 'clinic_phone') return context?.clinicPhone ?? ''
  // One line: a template variable cannot hold a line break.
  if (source === 'clinic_address') return (context?.clinicAddress ?? '').replace(/\s*\n\s*/g, ', ')
  if (source === 'next_appointment') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone })
  }
  // Split date/time -- some WhatsApp templates (Meta's own approved
  // "appointment_reminder" among them) have separate {{n}} slots for the
  // date and the time rather than one combined string like next_appointment.
  if (source === 'appointment_date') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone })
  }
  if (source === 'appointment_time') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone })
  }
  if (source.startsWith(ANSWER_PREFIX)) {
    const match = (context?.leadAnswers ?? []).filter((a) => answerKey(a.question) === source).pop()
    // One line, for the same reason as the address: Meta refuses a template
    // parameter with a line break in it, and a free-text answer can have one.
    return (match?.answer ?? '').trim().replace(/\s*\n\s*/g, ', ')
  }
  return ''
}
