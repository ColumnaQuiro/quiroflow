// Same shape clinics.business_hours already uses for the public booking page
// (pages/settings/clinics.vue) -- reused here so the staff Calendar and the
// booking page agree on what "open" means, instead of a second definition.
export type BusinessHours = Record<string, [string, string][]>

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function dayKeyFor(date: Date): string {
  return DAY_KEYS[date.getDay()]
}

export function windowsForDay(date: Date, hours: BusinessHours | null | undefined): [string, string][] {
  if (!hours) return []
  return hours[dayKeyFor(date)] ?? []
}

// A clinic that has never touched business hours has every day empty --
// treated as "not configured" rather than "closed every day", so the
// working-hours check stays opt-in until a clinic actually sets hours.
export function hasBusinessHoursConfigured(hours: BusinessHours | null | undefined): boolean {
  if (!hours) return false
  return Object.values(hours).some((windows) => windows.length > 0)
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function isWithinBusinessHours(date: Date, hours: BusinessHours | null | undefined): boolean {
  const windows = windowsForDay(date, hours)
  const mins = date.getHours() * 60 + date.getMinutes()
  return windows.some(([start, end]) => mins >= toMinutes(start) && mins < toMinutes(end))
}

// The hours a practitioner actually works on one day.
//
// A practitioner's own schedule is authoritative -- it is NOT narrowed by the
// clinic's hours. This mirrors PracticeHub, which has no global schedule at
// all: each practitioner carries their own, and that is the only thing that
// decides when they can be seen.
//
// Intersecting the two (which this used to do) meant a stale clinic record
// silently clipped real schedules. Beatriz works Monday 15:00-20:00, but the
// clinic record claimed a 13:00-16:00 closure, so her Monday came out as
// 16:00-20:00 and the first hour vanished. That closure was not real: 284
// appointments in the previous 120 days fell inside it.
//
// clinicWindows stays as the fallback for a practitioner who has never set
// hours -- an account that only fills in clinic hours keeps working, and the
// "any practitioner" booking option still has something to offer. Once a
// practitioner has hours of their own, the clinic's stop applying to them,
// and a day they left empty is a day off rather than "no restriction".
export function practitionerWindowsForDay(
  clinicWindows: [string, string][],
  practitionerHours: BusinessHours | null | undefined,
  dayKey: string,
): [string, string][] {
  if (!hasBusinessHoursConfigured(practitionerHours)) return clinicWindows
  return practitionerHours?.[dayKey] ?? []
}

function toHhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

/** Overlapping or touching windows folded together, in order. */
export function mergeWindows(windows: [string, string][]): [string, string][] {
  const ranges = windows.map(([s, e]) => [toMinutes(s), toMinutes(e)] as [number, number]).sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const r of ranges) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out.map(([s, e]) => [toHhmm(s), toHhmm(e)])
}

// When ANYONE is working on a day -- what the calendar leaves un-hatched when
// it is showing the whole clinic rather than one practitioner.
//
// Each practitioner contributes their own windows (practitionerWindowsForDay:
// their schedule, or the clinic's for someone who never set one). Returns
// null for "no restriction at all": if even one practitioner has no hours and
// the clinic has none to lend them, nothing says when that person is off, and
// hatching the day would claim a closure nobody configured -- the same
// opt-in rule hasBusinessHoursConfigured applies to a single schedule.
export function unionWorkingWindows(
  date: Date,
  clinicHours: BusinessHours | null | undefined,
  practitionerHours: (BusinessHours | null | undefined)[],
): [string, string][] | null {
  const clinicConfigured = hasBusinessHoursConfigured(clinicHours)
  const clinicWindows = windowsForDay(date, clinicHours)
  if (practitionerHours.length === 0) return clinicConfigured ? clinicWindows : null
  const all: [string, string][] = []
  for (const hours of practitionerHours) {
    if (!hasBusinessHoursConfigured(hours) && !clinicConfigured) return null
    all.push(...practitionerWindowsForDay(clinicWindows, hours, dayKeyFor(date)))
  }
  return mergeWindows(all)
}

/** Whether `mins` (minutes since midnight) falls inside any window. */
export function withinWindows(mins: number, windows: [string, string][]): boolean {
  return windows.some(([s, e]) => mins >= toMinutes(s) && mins < toMinutes(e))
}
