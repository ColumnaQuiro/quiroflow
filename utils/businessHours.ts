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
// silently clipped real schedules. Jordana works Monday 15:00-20:00, but the
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
