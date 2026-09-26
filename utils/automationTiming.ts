import { DEFAULT_CLINIC_TIMEZONE, startOfLocalDate } from './clinicClock'

// When an automation may act: a rule's quiet hours ("only send between 10:00
// and 20:00, Monday to Saturday") and a segment rule's schedule ("every Monday
// at 9:00"). Both are read in the clinic's own time zone, and both are plain
// functions of a clock so they can be tested without one.

export interface QuietHours {
  /** "HH:MM", inclusive. */
  from: string
  /** "HH:MM", exclusive. A window that wraps midnight is not supported. */
  to: string
  /** ISO weekdays the window applies on: 1 = Monday ... 7 = Sunday (0 also means Sunday). Empty or absent: every day. */
  days?: number[]
}

export interface SegmentSchedule {
  kind: 'once' | 'daily' | 'weekly'
  /** ISO weekday for 'weekly': 1 = Monday ... 7 = Sunday (0 also means Sunday). */
  weekday?: number
  /** "HH:MM" local time the segment is evaluated at ('daily'/'weekly'). */
  time?: string
  /** Not before this instant. For 'once', the moment it runs. */
  starts_at?: string
}

function minutesOf(hhmm: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** The clinic's calendar date, ISO weekday and minutes since midnight at `at`. */
export function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_CLINIC_TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[parts.weekday as string] ?? 1
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  }
}

function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y!, m! - 1, d! + days))
  return next.toISOString().slice(0, 10)
}

const isoWeekday = (day: number) => (day === 0 ? 7 : day)

/** The instant `minutes` past local midnight on `date`, at the clinic. */
function atLocal(date: string, minutes: number, timeZone: string): Date {
  return new Date(startOfLocalDate(date, timeZone || DEFAULT_CLINIC_TIMEZONE).getTime() + minutes * 60_000)
}

export function isValidQuietHours(quiet: unknown): quiet is QuietHours {
  if (!quiet || typeof quiet !== 'object') return false
  const q = quiet as QuietHours
  const from = minutesOf(q.from)
  const to = minutesOf(q.to)
  return from !== null && to !== null && from < to
}

/**
 * The first moment at or after `at` when a message may go out under these
 * quiet hours. `at` itself when it is already inside the window, or when
 * there are no (valid) quiet hours at all.
 */
export function nextAllowedSendTime(at: Date, quiet: QuietHours | null | undefined, timeZone: string): Date {
  if (!isValidQuietHours(quiet)) return at
  const from = minutesOf(quiet.from)!
  const to = minutesOf(quiet.to)!
  const days = (quiet.days ?? []).map(isoWeekday)
  const allowedDay = (weekday: number) => days.length === 0 || days.includes(weekday)

  const here = localParts(at, timeZone)
  if (allowedDay(here.weekday) && here.minutes >= from && here.minutes < to) return at

  for (let offset = 0; offset <= 7; offset++) {
    const date = addDays(here.date, offset)
    const weekday = ((here.weekday - 1 + offset) % 7) + 1
    if (!allowedDay(weekday)) continue
    const start = atLocal(date, from, timeZone)
    if (start.getTime() > at.getTime()) return start
  }
  return at
}

/**
 * The most recent moment the schedule was due at or before `now`, or null if
 * it has never been due. 'once' is due at starts_at (or straight away).
 */
export function lastScheduledOccurrence(schedule: SegmentSchedule | null | undefined, now: Date, timeZone: string, createdAt: Date): Date | null {
  if (!schedule) return null
  const startsAt = schedule.starts_at ? new Date(schedule.starts_at) : null
  if (startsAt && Number.isNaN(startsAt.getTime())) return null

  if (schedule.kind === 'once') {
    const at = startsAt ?? createdAt
    return at.getTime() <= now.getTime() ? at : null
  }

  const time = minutesOf(schedule.time) ?? 9 * 60
  const here = localParts(now, timeZone)
  for (let back = 0; back <= 7; back++) {
    const date = addDays(here.date, -back)
    const weekday = ((here.weekday - 1 - back + 7 * 2) % 7) + 1
    if (schedule.kind === 'weekly' && weekday !== isoWeekday(schedule.weekday ?? 1)) continue
    const at = atLocal(date, time, timeZone)
    if (at.getTime() > now.getTime()) continue
    if (startsAt && at.getTime() < startsAt.getTime()) return null
    return at
  }
  return null
}

/**
 * Whether a segment rule should be evaluated now: its latest occurrence has
 * come, and it has not run since. A rule never evaluates for an occurrence
 * from before it was created -- a daily 9:00 rule saved at 15:00 first runs
 * tomorrow, not the moment it is saved.
 */
export function segmentIsDue(schedule: SegmentSchedule | null | undefined, lastRunAt: Date | null, createdAt: Date, now: Date, timeZone: string): boolean {
  if (!schedule) return false
  if (schedule.kind === 'once') {
    if (lastRunAt) return false
    return lastScheduledOccurrence(schedule, now, timeZone, createdAt) !== null
  }
  const occurrence = lastScheduledOccurrence(schedule, now, timeZone, createdAt)
  if (!occurrence) return false
  const since = lastRunAt ?? createdAt
  return occurrence.getTime() > since.getTime()
}
