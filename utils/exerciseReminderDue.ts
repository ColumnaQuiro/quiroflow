import { clinicDateOf, localDay } from './clinicClock'

// Whether a patient's daily exercise reminder is due on this cron tick: in
// the hour they chose, read in their clinic's time zone, inside the first
// WINDOW minutes (the cron runs every 15, so the window always holds a tick),
// and not already sent on that clinic day. Pure, so it is tested; the sender
// is server/utils/exerciseReminders.ts.
export const EXERCISE_REMINDER_WINDOW_MINUTES = 20

export function exerciseReminderDue(
  patient: { exercise_reminder_hour: number | null; exercise_reminded_on: string | null },
  now: Date,
  timeZone: string,
): { due: boolean; day: string } {
  const day = clinicDateOf(now, timeZone)
  if (patient.exercise_reminder_hour === null || patient.exercise_reminder_hour === undefined) return { due: false, day }
  if (patient.exercise_reminded_on === day) return { due: false, day }
  const minutes = localDay(now, timeZone).minutesSinceMidnight
  const start = patient.exercise_reminder_hour * 60
  return { due: minutes >= start && minutes < start + EXERCISE_REMINDER_WINDOW_MINUTES, day }
}
