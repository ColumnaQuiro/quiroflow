import { DEFAULT_CLINIC_TIMEZONE } from './clinicClock'

// "Is it this patient's birthday today?" -- where the clinic is, not in UTC.
// The server runs in UTC, so reading "today" off its clock put a Madrid
// patient's birthday greeting on the wrong day for the first hour or two of
// every day (22:00-24:00 UTC is already tomorrow in Madrid).

/** The calendar date at `now` in `timeZone`, as YYYY-MM-DD. */
export function localDateString(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone || DEFAULT_CLINIC_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

/**
 * Whether a date of birth ("1990-09-27") falls on a calendar date. Compared
 * as month and day, the way the cron always has: someone born on 29 February
 * is greeted on 29 February, and only in years that have one.
 */
export function isBirthdayOn(dateOfBirth: string | null | undefined, localDate: string): boolean {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) return false
  return dateOfBirth.slice(5, 10) === localDate.slice(5, 10)
}
