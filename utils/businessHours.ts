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

// Pure intersection -- no windows on the practitioner's side means no
// overlap, so no availability. The "this practitioner hasn't set any hours"
// fallback deliberately does NOT live here: on a single day's windows it is
// impossible to tell "never configured" from "configured, but not working
// today", and conflating the two is what made practitioners bookable on
// their days off. practitionerWindowsForDay below owns that decision.
export function intersectWindows(clinicWindows: [string, string][], practitionerWindows: [string, string][] | undefined): [string, string][] {
  if (!practitionerWindows || practitionerWindows.length === 0) return []
  const result: [string, string][] = []
  for (const [cStart, cEnd] of clinicWindows) {
    const cStartMin = toMinutes(cStart)
    const cEndMin = toMinutes(cEnd)
    for (const [pStart, pEnd] of practitionerWindows) {
      const start = Math.max(cStartMin, toMinutes(pStart))
      const end = Math.min(cEndMin, toMinutes(pEnd))
      if (start < end) result.push([minutesToHHMM(start), minutesToHHMM(end)])
    }
  }
  return result
}

// The windows a practitioner can actually be seen in on one day: the clinic's
// hours narrowed by their own.
//
// The distinction that matters is per practitioner, not per day. Someone who
// has never set hours works the clinic's full hours -- that keeps
// per-practitioner scheduling opt-in, so an account that only fills in clinic
// hours behaves as it always has. But once a practitioner HAS hours, a day
// they left empty is a day off, not "no restriction". Reading it the other
// way round is what put Jordana (mon/tue/wed/thu) and Natacha (tue/wed/thu)
// on the booking page as available Monday-to-Friday, offering patients slots
// on days nobody was in.
export function practitionerWindowsForDay(
  clinicWindows: [string, string][],
  practitionerHours: BusinessHours | null | undefined,
  dayKey: string,
): [string, string][] {
  if (!hasBusinessHoursConfigured(practitionerHours)) return clinicWindows
  return intersectWindows(clinicWindows, practitionerHours?.[dayKey])
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
