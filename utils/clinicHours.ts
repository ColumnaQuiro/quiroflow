// A clinic's opening hours as Settings -> Clinics edits them.
//
// Same stored shape as ever -- clinics.business_hours, `{ mon: [['09:00',
// '14:00'], ...], ... }` -- because the calendar, the booking page, the public
// API and practitionerWindowsForDay (utils/businessHours.ts) all read it as it
// is. This only adds what an editor needs on top: every day present, ranges in
// order, and a reason when a day cannot be saved.
import type { BusinessHours } from './businessHours'

export const WEEK: { key: string; en: string; es: string }[] = [
  { key: 'mon', en: 'Monday', es: 'Lunes' },
  { key: 'tue', en: 'Tuesday', es: 'Martes' },
  { key: 'wed', en: 'Wednesday', es: 'Miércoles' },
  { key: 'thu', en: 'Thursday', es: 'Jueves' },
  { key: 'fri', en: 'Friday', es: 'Viernes' },
  { key: 'sat', en: 'Saturday', es: 'Sábado' },
  { key: 'sun', en: 'Sunday', es: 'Domingo' },
]

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Every day present (an absent day is a closed day), each day's ranges copied and in order. */
export function normalizeHours(hours: BusinessHours | null | undefined): BusinessHours {
  const out: BusinessHours = {}
  for (const d of WEEK) {
    const ranges = (hours?.[d.key] ?? []).map(([s, e]) => [s, e] as [string, string])
    out[d.key] = ranges.sort((a, b) => minutes(a[0]) - minutes(b[0]))
  }
  return out
}

export type HoursProblem = 'incomplete' | 'backwards' | 'overlap'

/** What is wrong with each day, if anything. An empty object means it can be saved. */
export function hoursProblems(hours: BusinessHours): Record<string, HoursProblem> {
  const out: Record<string, HoursProblem> = {}
  for (const d of WEEK) {
    const ranges = hours[d.key] ?? []
    if (ranges.some(([s, e]) => !/^\d{2}:\d{2}$/.test(s) || !/^\d{2}:\d{2}$/.test(e))) {
      out[d.key] = 'incomplete'
      continue
    }
    if (ranges.some(([s, e]) => minutes(e) <= minutes(s))) {
      out[d.key] = 'backwards'
      continue
    }
    const sorted = [...ranges].sort((a, b) => minutes(a[0]) - minutes(b[0]))
    if (sorted.some((r, i) => i > 0 && minutes(r[0]) < minutes(sorted[i - 1][1]))) out[d.key] = 'overlap'
  }
  return out
}

/** "9:00–14:00 y 16:00–20:00", or null for a closed day. */
export function dayRangesText(hours: BusinessHours | null | undefined, dayKey: string, and: string): string | null {
  const ranges = hours?.[dayKey] ?? []
  if (ranges.length === 0) return null
  const fmt = (hhmm: string) => hhmm.replace(/^0(\d)/, '$1')
  const parts = ranges.map(([s, e]) => `${fmt(s)}–${fmt(e)}`)
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`
}

/** Monday's ranges copied onto Tuesday to Friday. */
export function copyMondayToWeekdays(hours: BusinessHours): BusinessHours {
  const mon = hours.mon ?? []
  const out = { ...hours }
  for (const k of ['tue', 'wed', 'thu', 'fri']) out[k] = mon.map(([s, e]) => [s, e] as [string, string])
  return out
}
