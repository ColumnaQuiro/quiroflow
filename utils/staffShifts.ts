import type { BusinessHours } from './businessHours'

// Shifts and leave (20261016145412_shifts_and_leave.sql): what a person's day
// is planned to be, how it compares with what they clocked, and how many
// working days a leave request takes. Read the same way on the owners'
// Turnos tab and on "Mi jornada" in the web and the app.

export type ShiftRanges = [string, string][]
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Gaps over this many minutes between a shift and the clock are flagged. */
export const SHIFT_GAP_MINUTES = 15
/** Holiday days a year when the owner set none. */
export const DEFAULT_LEAVE_DAYS = 22

export const ABSENCE_KINDS = ['vacation', 'personal', 'sick', 'training'] as const
export type AbsenceKind = (typeof ABSENCE_KINDS)[number]
export function absenceKindLabel(kind: string, t: (en: string, es: string) => string): string {
  if (kind === 'vacation') return t('Holiday', 'Vacaciones')
  if (kind === 'personal') return t('Personal day', 'Asuntos propios')
  if (kind === 'sick') return t('Sick leave', 'Baja médica')
  return t('Training', 'Formación')
}

const dayKeyOf = (date: string) => DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/**
 * A person's shift on `date` (YYYY-MM-DD): that day's own hours when an owner
 * changed it, else their weekly hours, else -- for a practitioner with none
 * of their own -- the clinic's, which is what the calendar books them on.
 * null when nothing is set at all (front desk with no hours yet).
 */
export function shiftForDay(
  date: string,
  member: { business_hours: BusinessHours | null; is_practitioner: boolean },
  clinicHours: BusinessHours | null,
  dayOverride?: ShiftRanges,
): ShiftRanges | null {
  if (dayOverride) return dayOverride
  const own = member.business_hours
  if (own && Object.values(own).some((w) => w.length > 0)) return own[dayKeyOf(date)] ?? []
  if (member.is_practitioner && clinicHours) return clinicHours[dayKeyOf(date)] ?? []
  return null
}

export function shiftMinutes(ranges: ShiftRanges): number {
  return ranges.reduce((s, [a, b]) => s + Math.max(0, minutes(b) - minutes(a)), 0)
}

export function formatShift(ranges: ShiftRanges): string {
  return ranges.map(([a, b]) => `${a}–${b}`).join(' · ')
}

/** "09:00-14:00, 16:00-19:00" -> ranges; '' -> [] (not working); null when it does not read. */
export function parseShift(text: string): ShiftRanges | null {
  const trimmed = text.trim()
  if (!trimmed) return []
  const out: ShiftRanges = []
  for (const part of trimmed.split(/[,;·]/)) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const a = `${m[1]!.padStart(2, '0')}:${m[2]}`
    const b = `${m[3]!.padStart(2, '0')}:${m[4]}`
    if (minutes(b) <= minutes(a) || minutes(b) > 24 * 60) return null
    out.push([a, b])
  }
  return out.sort((x, y) => minutes(x[0]) - minutes(y[0]))
}

/**
 * How a clocked day sits against its shift: minutes late in (positive) or
 * early, and minutes late out (positive, stayed on) or early -- each only
 * when it is past SHIFT_GAP_MINUTES. Times are "HH:MM" on the clinic's clock.
 */
export function shiftGaps(ranges: ShiftRanges, clockedIn: string | null, clockedOut: string | null): { in: number | null; out: number | null } {
  if (!ranges.length) return { in: null, out: null }
  const start = minutes(ranges[0]![0])
  const end = minutes(ranges[ranges.length - 1]![1])
  const gap = (v: number) => (Math.abs(v) > SHIFT_GAP_MINUTES ? v : null)
  return {
    in: clockedIn ? gap(minutes(clockedIn) - start) : null,
    out: clockedOut ? gap(minutes(clockedOut) - end) : null,
  }
}

/**
 * Working days a request takes: Monday to Friday, less the days the whole
 * clinic is closed (`closed`, YYYY-MM-DD); half a day counts half.
 */
export function leaveWorkingDays(startsOn: string, endsOn: string, halfDay: boolean, closed: Set<string> = new Set()): number {
  let n = 0
  const end = new Date(`${endsOn}T12:00:00Z`)
  for (let d = new Date(`${startsOn}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6 && !closed.has(key)) n++
  }
  return halfDay ? n / 2 : n
}
