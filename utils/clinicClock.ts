// A clinic's own local time, from its time zone (clinics.timezone). The
// server runs in UTC, and a clinic can be anywhere: "9:00" and "today" have to
// be read in the clinic's zone, not the server's and not always Madrid's.
//
// Read from the actual wall clock at `now`, so the boundaries stay right
// across a daylight-saving change, which a fixed offset would get wrong twice
// a year.
export const DEFAULT_CLINIC_TIMEZONE = 'Europe/Madrid'

export function wallClock(now: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || DEFAULT_CLINIC_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  // Intl writes midnight as "24" in some runtimes.
  const hour = Number(parts.hour) % 24
  return { hour, minute: Number(parts.minute), second: Number(parts.second) }
}

/** The clinic's "today" as a UTC instant range, and how far into it `now` is. */
export function localDay(now: Date, timeZone: string) {
  const { hour, minute, second } = wallClock(now, timeZone)
  const secondsSinceMidnight = hour * 3600 + minute * 60 + second
  const start = new Date(now.getTime() - secondsSinceMidnight * 1000 - now.getMilliseconds())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end, minutesSinceMidnight: hour * 60 + minute }
}

/** How far `timeZone` is ahead of UTC at `at`, in minutes (Madrid in July: 120). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_CLINIC_TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second))
  return Math.round((asUtc - at.getTime()) / 60000)
}

/** The UTC instant a calendar date ("2026-12-24") begins at the clinic. */
export function startOfLocalDate(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // Twice: the offset at the guess can differ from the offset at the answer
  // when the date is the day the clocks change.
  let at = new Date(guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000)
  at = new Date(guess - zoneOffsetMinutes(at, timeZone) * 60000)
  return at
}

/** The next calendar date after `date`, as YYYY-MM-DD. */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}
