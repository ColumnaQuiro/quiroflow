// When an appointment's reminder goes out, decided for one appointment at a
// time so the rule can be tested without a database. The cron
// (server/api/automations/appointment-reminders-cron.post.ts) asks the
// database for the candidates and this for the verdict.
//
// The rule used to be a 20-minute window starting `hours` from now: an
// appointment was reminded on the tick when its time passed through it. That
// is right only while the number of hours stays put. Lower it after a
// reminder went out and the appointment passes through a second window and is
// reminded again; raise it and the new window is already behind the
// appointment, so it is never reminded at all. With a per-patient override
// either can happen to any single patient at any time.
//
// So the window is open-ended instead: the reminder is due from `hours` before
// the visit onwards, and the appointment's own `reminder_claimed_at` says it
// has been dealt with for its current time (a trigger clears it when the
// appointment moves). Whatever the setting was or becomes, each appointment
// time is reminded once.

/** The clinic's default when it has none stored, as settings/messages.vue saves. */
export const DEFAULT_REMINDER_HOURS = 24

/** pg_cron calls the endpoint every 15 minutes (job appointment-reminders-15min). */
export const REMINDER_CRON_INTERVAL_MINUTES = 15

/**
 * A reminder that comes late is still worth sending, but not in the last
 * couple of hours before the visit, when it is only noise. Shorter for a
 * patient who asked to be told two hours before: half their lead, so a tick
 * that runs late still reaches them.
 */
export const LATE_REMINDER_MIN_LEAD_HOURS = 2

/** The choices offered on the patient record. Any 1-168 is accepted. */
export const PATIENT_REMINDER_HOUR_OPTIONS = [2, 3, 6, 12, 24, 48, 72] as const

export interface ReminderCandidate {
  starts_at: string
  created_at: string
  confirmation_sent_at: string | null
  reminder_claimed_at: string | null
  rescheduled: boolean | null
}

export type ReminderDecision =
  /** Already dealt with for its current time. */
  | 'done'
  /** Its reminder time has not come yet. */
  | 'not_yet'
  /** Remind now. */
  | 'send'
  /** Never, for this time: too close to the visit, or the confirmation said it. */
  | 'skip'

const HOUR = 60 * 60 * 1000

/** The patient's own choice wins; then the clinic's; then the default. */
export function effectiveReminderHours(patientHours: number | null | undefined, clinicHours: number | null | undefined): number {
  return patientHours ?? clinicHours ?? DEFAULT_REMINDER_HOURS
}

export function lateReminderMinLeadHours(hoursBefore: number): number {
  return Math.min(LATE_REMINDER_MIN_LEAD_HOURS, hoursBefore / 2)
}

/**
 * When the reminder for a visit at `startsAt` becomes due. The tick before the
 * exact mark, not the one after, so "24 hours before" never arrives at 23h50
 * -- the old window sent up to one tick early too.
 */
export function reminderOpensAt(startsAt: Date, hoursBefore: number): Date {
  return new Date(startsAt.getTime() - hoursBefore * HOUR - REMINDER_CRON_INTERVAL_MINUTES * 60 * 1000)
}

/**
 * The starts_at range a tick has to look at for appointments with this lead:
 * everything whose reminder has opened and that is not yet too close.
 */
export function reminderCandidateRange(hoursBefore: number, now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() + lateReminderMinLeadHours(hoursBefore) * HOUR),
    to: new Date(now.getTime() + hoursBefore * HOUR + REMINDER_CRON_INTERVAL_MINUTES * 60 * 1000),
  }
}

export function appointmentReminderDecision(appt: ReminderCandidate, hoursBefore: number, now: Date): ReminderDecision {
  if (appt.reminder_claimed_at) return 'done'
  const startsAt = new Date(appt.starts_at)
  const opensAt = reminderOpensAt(startsAt, hoursBefore)
  if (now < opensAt) return 'not_yet'
  if (startsAt.getTime() - now.getTime() < lateReminderMinLeadHours(hoursBefore) * HOUR) return 'skip'
  // Booked once its reminder time had already come -- tomorrow morning,
  // booked tonight -- and the confirmation went out: that told the patient
  // the same thing a moment ago. Not once it has been moved, because the
  // confirmation named the old time.
  const bookedLate = new Date(appt.created_at) >= opensAt
  if (bookedLate && appt.confirmation_sent_at && !appt.rescheduled) return 'skip'
  return 'send'
}
