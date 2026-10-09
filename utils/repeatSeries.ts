// The dates a repeating booking lands on, and which of them do not fit.
//
// A repeat is calendar arithmetic, not a fixed number of milliseconds. The
// create panel used to add i x 7 x 24h to the first start, which is a week
// only when no clock change falls inside it: a weekly 10:00 series crossing
// the last Sunday of October came out at 09:00 from then on. "Monthly" was 30
// days, so a Tuesday visit repeated on a Thursday, and "daily" booked the
// weekend. Each date here is built from the first one's wall-clock parts --
// year, month, day, hour, minute -- in the runtime's zone, which is the staff
// browser's and the one the whole calendar reads times in.
//
// Pure, so the rules are pinned without a browser (tests/unit/
// repeat-series.test.ts).

import { firstClash, type Busy } from './freeSlots'

export type RepeatUnit = 'day' | 'week' | 'month'

export interface RepeatRule {
  unit: RepeatUnit
  /** Every how many units: 1 for "weekly", 2 for a care plan of every two weeks. */
  every: number
  /** How many visits, the first included. */
  count: number
  /**
   * Visits in each period, for a care plan of "2 a week" (week and month
   * units). They are spread evenly through the period on the same days each
   * time -- 2 a week from a Monday is Monday and Thursday, 3 is Monday,
   * Wednesday, Friday. Default 1.
   */
  perPeriod?: number
  /**
   * Days to step over instead of booking -- only for `unit: 'day'`, where
   * "daily" means every day the patient could actually be seen. The first
   * date is always kept: it is the one the desk picked.
   */
  skipDay?: (day: Date) => boolean
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one; Date carries the
  // year over for month 12.
  return new Date(year, month + 1, 0).getDate()
}

/** Every start in the series, first included, at the first one's wall-clock time. */
export function seriesStarts(first: Date, rule: RepeatRule): Date[] {
  const y = first.getFullYear()
  const m = first.getMonth()
  const d = first.getDate()
  const h = first.getHours()
  const mi = first.getMinutes()
  const every = Math.max(1, rule.every)
  const out: Date[] = []
  if (rule.count <= 0) return out

  const perPeriod = Math.max(1, Math.min(7, Math.floor(rule.perPeriod ?? 1)))
  if (perPeriod > 1 && (rule.unit === 'week' || rule.unit === 'month')) {
    // Each period starts where a one-a-period series would have put its
    // visit; the others sit at whole-day offsets through the period (a month
    // is taken as four weeks for spacing, so the days stay put).
    const periodDays = rule.unit === 'week' ? 7 * every : 28 * every
    const offsets = Array.from({ length: perPeriod }, (_, j) => Math.floor((j * periodDays) / perPeriod))
    for (let i = 0; out.length < rule.count; i++) {
      const base = rule.unit === 'week' ? new Date(y, m, d + i * 7 * every, h, mi) : new Date(y, m + i * every, Math.min(d, daysInMonth(y, m + i * every)), h, mi)
      for (const off of offsets) {
        if (out.length >= rule.count) break
        out.push(new Date(base.getFullYear(), base.getMonth(), base.getDate() + off, h, mi))
      }
    }
    return out
  }

  if (rule.unit === 'month') {
    for (let i = 0; i < rule.count; i++) {
      const month = m + i * every
      // The same day of the month, or the month's last day when it is
      // shorter: the 31st repeats on 28 Feb, then on 31 Mar again.
      out.push(new Date(y, month, Math.min(d, daysInMonth(y, month)), h, mi))
    }
    return out
  }

  if (rule.unit === 'week') {
    for (let i = 0; i < rule.count; i++) out.push(new Date(y, m, d + i * 7 * every, h, mi))
    return out
  }

  // Daily. Bounded, so a schedule with every day closed ends the series short
  // rather than looping for ever.
  const limit = rule.count * 7
  for (let k = 0; out.length < rule.count && k < limit; k++) {
    const day = new Date(y, m, d + k * every, h, mi)
    if (k > 0 && rule.skipDay?.(day)) continue
    out.push(day)
  }
  return out
}

export interface SeriesProblem {
  /** Position in the series, 0 for the first visit. */
  index: number
  start: Date
  /** The first booking or block it overlaps, if any. */
  clash: Busy | null
  outOfHours: boolean
}

/**
 * The dates in a series that overlap something already booked, or fall
 * outside the practitioner's hours. Empty when the whole series fits.
 *
 * `overlapAllowedAt` lists positions where an overlap was booked on purpose
 * ("Book it anyway, overlapping" in the panel answers for the one time it was
 * shown, the first), so a clash there is not reported again.
 */
export function seriesProblems(
  starts: Date[],
  durationMin: number,
  busy: Busy[],
  outside: (start: Date, end: Date) => boolean,
  opts: { overlapAllowedAt?: number[] } = {},
): SeriesProblem[] {
  const allowed = new Set(opts.overlapAllowedAt ?? [])
  const out: SeriesProblem[] = []
  starts.forEach((start, index) => {
    const s = start.getTime()
    const e = s + durationMin * 60000
    const clash = allowed.has(index) ? null : firstClash(s, e, busy)
    const outOfHours = outside(start, new Date(e))
    if (clash || outOfHours) out.push({ index, start, clash, outOfHours })
  })
  return out
}
