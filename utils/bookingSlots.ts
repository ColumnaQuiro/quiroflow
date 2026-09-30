// The times a patient is offered on a day: the public booking page
// (pages/book/[slug].vue) and the patient app (mobile/pages/book.vue) both
// build them here, so the two cannot drift apart -- and so they agree with
// what the booking functions accept (assert_booking_slot_open in
// 20260930141539_online_booking_obeys_the_calendar.sql).
//
// Everything is read in the CLINIC's time zone. Both screens used to build
// slots with Date#setHours, which is the DEVICE's zone: a patient booking a
// Madrid clinic from the Canaries was offered 09:00 Canaries time as the
// clinic's 09:00 (really 10:00 in Madrid), and one abroad was offered hours
// the clinic is shut. The weekday came from getDay(), the device's weekday,
// which near midnight is not the clinic's.
//
// Pure, with no `~` imports: the app auto-imports this directory too, and in
// its build `~` resolves to mobile/.
import { practitionerWindowsForDay, type BusinessHours } from './businessHours'
import { DEFAULT_CLINIC_TIMEZONE, wallClock, wallClockToUtc } from './clinicClock'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export interface BookingBusyRange {
  starts_at: string
  ends_at: string
}

/** "2026-10-05" for the calendar cell a Date stands for (its own y/m/d, as the grid built it). */
export function calendarDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Weekday key ('mon'…) of a calendar date -- the date's own, whatever zone the device is in. */
export function weekdayKeyOf(date: string): string {
  return DAY_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
}

/** The hours a practitioner works on a calendar date: practitionerWindowsForDay, keyed by the date itself. */
export function bookingWindowsFor(date: string, clinicHours: BusinessHours | null | undefined, practitionerHours: BusinessHours | null | undefined): [string, string][] {
  const day = weekdayKeyOf(date)
  return practitionerWindowsForDay(clinicHours?.[day] ?? [], practitionerHours, day)
}

export interface BookingSlotQuery {
  /** The clinic's calendar date, YYYY-MM-DD. */
  date: string
  timeZone: string | null | undefined
  clinicHours: BusinessHours | null | undefined
  practitionerHours: BusinessHours | null | undefined
  durationMinutes: number
  /** Their appointments and the blocks that apply to them (whole clinic or theirs). */
  busy: BookingBusyRange[]
  /** Only starts strictly after this. Defaults to now. */
  notBefore?: Date
  /** Only starts at or before this, when set (the booking horizon). */
  notAfter?: Date
}

/**
 * The starts offered on one day: stepped by the visit's own length from the
 * start of each working window, the whole visit inside the window, clear of
 * everything busy.
 */
export function bookingSlotsForDay(q: BookingSlotQuery): Date[] {
  const timeZone = q.timeZone || DEFAULT_CLINIC_TIMEZONE
  const duration = q.durationMinutes * 60000
  if (duration <= 0) return []
  const notBefore = (q.notBefore ?? new Date()).getTime()
  const notAfter = q.notAfter?.getTime()
  const busy = q.busy.map((b) => ({ start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) }))
  const out: Date[] = []
  for (const [open, close] of bookingWindowsFor(q.date, q.clinicHours, q.practitionerHours)) {
    const windowEnd = wallClockToUtc(q.date, close, timeZone)
    for (let cursor = wallClockToUtc(q.date, open, timeZone); cursor + duration <= windowEnd; cursor += duration) {
      if (cursor <= notBefore) continue
      if (notAfter !== undefined && cursor > notAfter) continue
      const end = cursor + duration
      if (busy.some((b) => b.start < end && b.end > cursor)) continue
      out.push(new Date(cursor))
    }
  }
  return out
}

/** "09:30" -- a slot as the clinic's clock shows it. */
export function clinicTimeLabel(at: Date, timeZone: string | null | undefined): string {
  return at.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: timeZone || DEFAULT_CLINIC_TIMEZONE })
}

/** The clinic's hour at `at`, for splitting a day into morning and afternoon. */
export function clinicHourOf(at: Date, timeZone: string | null | undefined): number {
  return wallClock(at, timeZone || DEFAULT_CLINIC_TIMEZONE).hour
}
