import { clinicDateOf } from './clinicClock'
import { leaveWorkingDays } from './staffShifts'

// The team's leave across a year, for Personal (pages/personal.vue): what each
// person has left, and the days two or more practitioners are off at once.
// Pure, so the arithmetic is tested apart from the screens.

export interface TeamAbsence {
  id: string
  team_member_id: string
  kind: string
  starts_on: string
  ends_on: string
  half_day: boolean
  status: string
}

/** Every day of `year`, YYYY-MM-DD. */
export function daysOfYear(year: number): string[] {
  const out: string[] = []
  for (let d = new Date(Date.UTC(year, 0, 1, 12)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}

/**
 * The days the whole clinic is closed, from its whole-clinic availability
 * blocks ("Cierres y festivos" and the automatic public holidays), as clinic
 * calendar days.
 */
export function clinicClosedDays(blocks: { starts_at: string; ends_at: string }[], timeZone: string): Set<string> {
  const shut = new Set<string>()
  for (const b of blocks) {
    const end = new Date(b.ends_at)
    for (let d = new Date(b.starts_at); d < end; d.setUTCDate(d.getUTCDate() + 1)) shut.add(clinicDateOf(d, timeZone))
  }
  return shut
}

/** The part of an absence inside `year`, or null when it has none. Open-ended ones end at the year's end. */
export function absenceInYear(a: { starts_on: string; ends_on: string }, year: number): { from: string; to: string } | null {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  if (a.ends_on < first || a.starts_on > last) return null
  return { from: a.starts_on < first ? first : a.starts_on, to: a.ends_on > last ? last : a.ends_on }
}

export interface LeaveBalance {
  allowance: number
  /** Approved holiday already behind them (ended before today). */
  taken: number
  /** Approved holiday still to come, today included. */
  coming: number
  /** Asked for and not decided yet. */
  pending: number
  /** The allowance less taken and coming; pending is not taken off until approved. */
  left: number
}

/**
 * One person's holiday in `year`: working days only (Monday to Friday, less
 * days the clinic is closed), and only the days that fall in that year, so a
 * holiday over New Year counts in each year for its own days.
 */
export function teamLeaveBalance(absences: TeamAbsence[], allowance: number, year: number, today: string, closed: Set<string>): LeaveBalance {
  let taken = 0
  let coming = 0
  let pending = 0
  for (const a of absences) {
    if (a.kind !== 'vacation') continue
    const span = absenceInYear(a, year)
    if (!span) continue
    const days = leaveWorkingDays(span.from, span.to, a.half_day, closed)
    if (a.status === 'pending') pending += days
    else if (a.status === 'approved') {
      if (a.ends_on < today) taken += days
      else coming += days
    }
  }
  return { allowance, taken, coming, pending, left: allowance - taken - coming }
}

/**
 * The days in `year` on which `min` or more of `practitionerIds` are away,
 * a whole day, approved or still pending -- a pending request is exactly when
 * an owner wants to know who else is off. Weekends and closed days are left
 * out: nobody is missed on a day the clinic is shut.
 */
export function leaveOverlaps(absences: TeamAbsence[], practitionerIds: Set<string>, year: number, closed: Set<string>, min = 2): Map<string, string[]> {
  const byDay = new Map<string, Set<string>>()
  for (const a of absences) {
    if (a.half_day || !practitionerIds.has(a.team_member_id)) continue
    if (a.status !== 'approved' && a.status !== 'pending') continue
    const span = absenceInYear(a, year)
    if (!span) continue
    const end = new Date(`${span.to}T12:00:00Z`)
    for (let d = new Date(`${span.from}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay()
      const key = d.toISOString().slice(0, 10)
      if (wd === 0 || wd === 6 || closed.has(key)) continue
      if (!byDay.has(key)) byDay.set(key, new Set())
      byDay.get(key)!.add(a.team_member_id)
    }
  }
  const out = new Map<string, string[]>()
  for (const [day, who] of byDay) if (who.size >= min) out.set(day, [...who])
  return out
}

/**
 * Holiday days carried into `year` from the year before, when the clinic
 * allows it (accounts.leave_carry_over_days, set in Turnos): what was left
 * of last year's own allowance, up to `maxCarry`. It does not chain -- days
 * carried into last year and not taken there do not move on again -- so
 * only last year's absences are needed. `prevAbsences` may hold anything;
 * only approved holiday inside `year - 1` counts.
 */
export function leaveCarryIn(prevAbsences: TeamAbsence[], allowance: number, year: number, closedPrev: Set<string>, maxCarry: number): number {
  if (!maxCarry || maxCarry <= 0) return 0
  let taken = 0
  for (const a of prevAbsences) {
    if (a.kind !== 'vacation' || a.status !== 'approved') continue
    const span = absenceInYear(a, year - 1)
    if (span) taken += leaveWorkingDays(span.from, span.to, a.half_day, closedPrev)
  }
  return Math.min(maxCarry, Math.max(0, allowance - taken))
}
