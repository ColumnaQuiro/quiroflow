// "Can she come Thursday at six?" -- the two answers the create panel gives
// while a booking is being made: whether the time asked for clashes with
// something already booked, and if it does (or anyway), the next times that
// do not. Pure, so the rules are pinned without a database.

import { withinWindows } from './businessHours'

export interface Busy {
  start: number
  end: number
  /** Who is in it, for "Javier tiene a Clara Vidal a las 20:30". */
  label?: string
}

/** The first booking overlapping [start, end), if any. */
export function firstClash(start: number, end: number, busy: Busy[]): Busy | null {
  return busy.filter((b) => b.start < end && b.end > start).sort((a, b) => a.start - b.start)[0] ?? null
}

export interface FreeSlotSearch {
  /** Search from here onwards. */
  from: Date
  durationMin: number
  /** Candidate starts are on this grid (the clinic's slot size). */
  stepMin: number
  /** When the practitioner works on a day; null = no hours configured, any time. */
  windowsFor: (day: Date) => [string, string][] | null
  busy: Busy[]
  count: number
  /** How many days ahead to look before giving up. */
  days: number
  /** The calendar's visible hours, for days with no configured windows. */
  dayStartHour?: number
  dayEndHour?: number
  /** Nothing earlier than this is offered (defaults to `from`). */
  notBefore?: Date
}

/**
 * The next `count` starts, from `from`, that fit the duration inside working
 * hours and overlap nothing booked.
 */
export function findFreeSlots(q: FreeSlotSearch): Date[] {
  const out: Date[] = []
  const notBefore = (q.notBefore ?? q.from).getTime()
  const dayStart = (q.dayStartHour ?? 8) * 60
  const dayEnd = (q.dayEndHour ?? 20) * 60
  for (let d = 0; d < q.days && out.length < q.count; d++) {
    const day = new Date(q.from)
    day.setDate(day.getDate() + d)
    day.setHours(0, 0, 0, 0)
    const windows = q.windowsFor(day)
    if (windows && windows.length === 0) continue
    for (let m = dayStart; m + q.durationMin <= dayEnd && out.length < q.count; m += q.stepMin) {
      const start = new Date(day)
      start.setMinutes(m)
      const s = start.getTime()
      if (s < notBefore) continue
      const e = s + q.durationMin * 60000
      // The whole visit inside the hours, not just its start.
      if (windows && (!withinWindows(m, windows) || !withinWindows(m + q.durationMin - 1, windows))) continue
      if (firstClash(s, e, q.busy)) continue
      out.push(start)
    }
  }
  return out
}
