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
//
// The clinic's own setting is a number of DAYS, and the reminder goes out at
// REMINDER_SEND_HOUR on that day, clinic time: "1 day before" reminds every
// visit of tomorrow together at 10:00 today, whatever hour each visit is at.
// Counting hours sent them all day long, each 24 hours before its own visit,
// so a 9:00 visit was reminded at 9:00 and a 19:00 one at 19:00 -- patients
// heard from the clinic at odd times and the front desk could not answer the
// replies in one go. A patient's own override (patients.appointment_reminder_
// hours_before) is still hours: it exists for the patient who wants to be
// told two hours before, which a day count cannot say.

import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE, wallClockToUtc } from './clinicClock'

/** The clinic's default when it has none stored, as settings/messages.vue saves. */
export const DEFAULT_REMINDER_DAYS = 1

/** The longest lead the clinic's setting allows (and the column's check). */
export const MAX_REMINDER_DAYS = 7

/** The hour of the day, at the clinic, that the day-based reminders go out. */
export const REMINDER_SEND_HOUR = 10

/** "N days before, at 10:00 clinic time": the clinic's setting. */
export interface DaysBefore {
  days: number
  timeZone: string
}

/** A number is hours (a patient's own override); otherwise days at 10:00. */
export type ReminderLead = number | DaysBefore

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
const DAY = 24 * HOUR

/** A stored day count, as the column's check allows it. */
export function clampReminderDays(days: number | null | undefined): number {
  if (typeof days !== 'number' || !Number.isInteger(days)) return DEFAULT_REMINDER_DAYS
  return Math.min(MAX_REMINDER_DAYS, Math.max(1, days))
}

/**
 * The patient's own choice (hours) wins; then the clinic's days, at 10:00
 * in the visit's clinic's time zone; then the default.
 */
export function effectiveReminderLead(patientHours: number | null | undefined, clinicDays: number | null | undefined, timeZone: string | null | undefined): ReminderLead {
  if (patientHours != null) return patientHours
  return { days: clampReminderDays(clinicDays), timeZone: timeZone || DEFAULT_CLINIC_TIMEZONE }
}

export function lateReminderMinLeadHours(lead: ReminderLead): number {
  if (typeof lead !== 'number') return LATE_REMINDER_MIN_LEAD_HOURS
  return Math.min(LATE_REMINDER_MIN_LEAD_HOURS, lead / 2)
}

/** `date` (YYYY-MM-DD) moved by `days` calendar days. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * When the reminder for a visit at `startsAt` becomes due.
 *
 * In hours: the tick before the exact mark, not the one after, so "24 hours
 * before" never arrives at 23h50 -- the old window sent up to one tick early
 * too.
 *
 * In days: 10:00 at the clinic on the calendar day that many days before the
 * visit's own day there. Read on the clinic's calendar, not as 24-hour steps,
 * so a visit on the Monday after the clocks change is still reminded at 10:00
 * on the Sunday.
 */
export function reminderOpensAt(startsAt: Date, lead: ReminderLead): Date {
  if (typeof lead === 'number') return new Date(startsAt.getTime() - lead * HOUR - REMINDER_CRON_INTERVAL_MINUTES * 60 * 1000)
  const sendDay = shiftDate(clinicDateOf(startsAt, lead.timeZone), -lead.days)
  return new Date(wallClockToUtc(sendDay, `${String(REMINDER_SEND_HOUR).padStart(2, '0')}:00`, lead.timeZone))
}

/**
 * The starts_at range a tick has to look at for appointments with this lead:
 * everything whose reminder has opened and that is not yet too close. For a
 * day count that is up to the end of the clinic's day `days` from today --
 * read here as a day more than `days`, plus an hour for a clock change, since
 * one query serves clinics in every time zone; the verdict sorts out the rest.
 */
export function reminderCandidateRange(lead: ReminderLead, now: Date): { from: Date; to: Date } {
  const from = new Date(now.getTime() + lateReminderMinLeadHours(lead) * HOUR)
  if (typeof lead === 'number') return { from, to: new Date(now.getTime() + lead * HOUR + REMINDER_CRON_INTERVAL_MINUTES * 60 * 1000) }
  return { from, to: new Date(now.getTime() + (lead.days + 1) * DAY + HOUR) }
}

export function appointmentReminderDecision(appt: ReminderCandidate, lead: ReminderLead, now: Date): ReminderDecision {
  if (appt.reminder_claimed_at) return 'done'
  const startsAt = new Date(appt.starts_at)
  const opensAt = reminderOpensAt(startsAt, lead)
  if (now < opensAt) return 'not_yet'
  if (startsAt.getTime() - now.getTime() < lateReminderMinLeadHours(lead) * HOUR) return 'skip'
  // Booked once its reminder time had already come -- tomorrow morning,
  // booked tonight -- and the confirmation went out: that told the patient
  // the same thing a moment ago. Not once it has been moved, because the
  // confirmation named the old time.
  const bookedLate = new Date(appt.created_at) >= opensAt
  if (bookedLate && appt.confirmation_sent_at && !appt.rescheduled) return 'skip'
  return 'send'
}

/**
 * Whether a patient's answer to a visit (Confirmar, or asking to change it)
 * was an answer to a reminder of it: given at or after one of the reminders
 * already sent for it. A reminder automation passes over a visit only then
 * (filters.skip_if_answered). The message sent when the visit is booked
 * carries the same Confirmar button, and an answer to that one, before any
 * reminder, must not silence them all: it is how 47 confirmed visits went
 * unreminded between 19 and 22 Oct 2026.
 */
export function answeredAReminder(answeredAt: string | null | undefined, reminderSentAts: (string | null | undefined)[]): boolean {
  if (!answeredAt) return false
  const answered = Date.parse(answeredAt)
  return reminderSentAts.some((sent) => Boolean(sent) && Date.parse(sent!) <= answered)
}
