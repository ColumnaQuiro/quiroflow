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

// A practitioner without their own configured hours is bookable across the
// clinic's full hours (opt-in override, same convention as
// hasBusinessHoursConfigured) -- so an empty/undefined practitionerWindows
// means "no restriction", not "no availability".
export function intersectWindows(clinicWindows: [string, string][], practitionerWindows: [string, string][] | undefined): [string, string][] {
  if (!practitionerWindows || practitionerWindows.length === 0) return clinicWindows
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

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
