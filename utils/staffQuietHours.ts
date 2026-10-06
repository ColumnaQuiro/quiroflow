import type { BusinessHours } from './businessHours'
import { hasBusinessHoursConfigured } from './businessHours'
import { bookingWindowsFor } from './bookingSlots'
import { clinicDateOf, localDay } from './clinicClock'

// "No molestar: fuera de mi horario" (server/utils/staffPush.ts). Read in the
// clinic's time zone -- the server runs in UTC, so businessHours.ts's
// outsideWorkingHours, which reads a Date's own local clock, would put a
// Madrid practitioner's 9:00 at 7:00 for half the year.

/** Whether `at` falls outside this person's hours (theirs, else the clinic's). Never when no hours are set anywhere. */
export function outsideHoursInZone(at: Date, timeZone: string, clinicHours: BusinessHours | null | undefined, ownHours: BusinessHours | null | undefined): boolean {
  if (!hasBusinessHoursConfigured(clinicHours) && !hasBusinessHoursConfigured(ownHours)) return false
  const windows = bookingWindowsFor(clinicDateOf(at, timeZone), clinicHours, ownHours)
  const mins = localDay(at, timeZone).minutesSinceMidnight
  return !windows.some(([s, e]) => {
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    return mins >= sh * 60 + sm && mins < eh * 60 + em
  })
}
