// The Retention report's arithmetic (pages/reports/retention.vue). Pure, so
// the rules are pinned by tests/unit/retention-stats.test.ts.
//
// A visit is an appointment that happened: status 'completed'. Booked,
// cancelled and no-show ones are read only as "what came next".
import { clinicDateOf } from './clinicClock'

export interface RetentionVisit {
  patient_id: string
  practitioner_id: string | null
  starts_at: string
  ends_at: string
  status: string
  created_at: string
}

const DAY = 86_400_000

export interface CohortRow {
  /** 'YYYY-MM' of the first visit, on the clinic's calendar. */
  month: string
  patients: number
  /** Had a second visit at any time. */
  cameBack: number
  /** Of those whose first visit is at least 90 / 180 days ago: still visiting by then (a visit on or after that day). Null when nobody in the month is old enough. */
  at90: { of: number; still: number } | null
  at180: { of: number; still: number } | null
}

/**
 * Patients by the month of their first visit -- the first ever, not the first
 * in the range, so a returning patient is not counted as new -- for the
 * months from `from` to `to`.
 */
export function cohortRetention(visits: RetentionVisit[], opts: { from: Date; to: Date; now: Date; timeZone: string }): CohortRow[] {
  const byPatient = new Map<string, number[]>()
  for (const v of visits) {
    if (v.status !== 'completed') continue
    const list = byPatient.get(v.patient_id) ?? []
    list.push(Date.parse(v.starts_at))
    byPatient.set(v.patient_id, list)
  }
  const rows = new Map<string, CohortRow>()
  for (const times of byPatient.values()) {
    times.sort((a, b) => a - b)
    const first = times[0]!
    if (first < opts.from.getTime() || first > opts.to.getTime()) continue
    const month = clinicDateOf(new Date(first), opts.timeZone).slice(0, 7)
    const row = rows.get(month) ?? { month, patients: 0, cameBack: 0, at90: null, at180: null }
    row.patients++
    if (times.length > 1) row.cameBack++
    for (const [key, days] of [['at90', 90], ['at180', 180]] as const) {
      if (opts.now.getTime() - first < days * DAY) continue
      const cell = row[key] ?? { of: 0, still: 0 }
      cell.of++
      if (times.some((t) => t >= first + days * DAY)) cell.still++
      row[key] = cell
    }
    rows.set(month, row)
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export interface RebookingRow {
  practitionerId: string | null
  visits: number
  /** Left with the next visit booked: another appointment, not cancelled, after this one, created by the end of the visit day (12 h after it ended). */
  rebooked: number
  /** Of the visits at least 30 days ago: had another visit within 30 days. */
  cameBack30: { of: number; came: number }
}

/** Per practitioner, the visits in [from, to] and what followed them. */
export function rebookingByPractitioner(visits: RetentionVisit[], opts: { from: Date; to: Date; now: Date }): RebookingRow[] {
  const byPatient = new Map<string, RetentionVisit[]>()
  for (const v of visits) {
    const list = byPatient.get(v.patient_id) ?? []
    list.push(v)
    byPatient.set(v.patient_id, list)
  }
  const rows = new Map<string, RebookingRow>()
  for (const v of visits) {
    if (v.status !== 'completed') continue
    const start = Date.parse(v.starts_at)
    if (start < opts.from.getTime() || start > opts.to.getTime()) continue
    const key = v.practitioner_id ?? ''
    const row = rows.get(key) ?? { practitionerId: v.practitioner_id, visits: 0, rebooked: 0, cameBack30: { of: 0, came: 0 } }
    row.visits++
    const end = Date.parse(v.ends_at)
    const later = (byPatient.get(v.patient_id) ?? []).filter((o) => o !== v && o.status !== 'cancelled' && Date.parse(o.starts_at) > start)
    if (later.some((o) => Date.parse(o.created_at) <= end + 12 * 3_600_000)) row.rebooked++
    if (opts.now.getTime() - start >= 30 * DAY) {
      row.cameBack30.of++
      if (later.some((o) => o.status === 'completed' && Date.parse(o.starts_at) <= start + 30 * DAY)) row.cameBack30.came++
    }
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => b.visits - a.visits)
}

/** A share as a whole percentage, or null when there is nothing to divide by. */
export function retentionPct(part: number, of: number): number | null {
  return of > 0 ? Math.round((part / of) * 100) : null
}

/**
 * Win-back: of the patients someone reached out to (a call, a WhatsApp from
 * Recalls or the bulk send -- contact_log rows not about an appointment), how
 * many booked within 30 days of it. Each patient counts once, from their
 * first contact in the period. A contact under 30 days old that has not
 * booked yet is still `waiting`, not a failure.
 */
export interface WinBackContact { patient_id: string; created_at: string }
export interface WinBackBooking { patient_id: string; created_at: string }
export interface WinBackStats { contacted: number; booked: number; waiting: number }

export function winBackStats(contacts: WinBackContact[], bookings: WinBackBooking[], opts: { from: Date; to: Date; now: Date }): WinBackStats {
  const WINDOW = 30 * 86_400_000
  const first = new Map<string, number>()
  for (const c of contacts) {
    const at = Date.parse(c.created_at)
    if (at < opts.from.getTime() || at >= opts.to.getTime()) continue
    if (!first.has(c.patient_id) || at < first.get(c.patient_id)!) first.set(c.patient_id, at)
  }
  const booked = new Set<string>()
  for (const b of bookings) {
    const at = first.get(b.patient_id)
    if (at === undefined) continue
    const made = Date.parse(b.created_at)
    if (made > at && made <= at + WINDOW) booked.add(b.patient_id)
  }
  let waiting = 0
  for (const [patient, at] of first) if (!booked.has(patient) && opts.now.getTime() - at < WINDOW) waiting++
  return { contacted: first.size, booked: booked.size, waiting }
}
