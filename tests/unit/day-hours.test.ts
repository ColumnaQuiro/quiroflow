import { describe, it, expect } from 'vitest'
import {
  hasBusinessHoursConfigured,
  hoursKnownOn,
  outsideWorkingHours,
  practitionerHoursAt,
  practitionerWindowsForDay,
  practitionerWindowsOn,
  unionWorkingWindows,
  withDayHours,
  type BusinessHours,
} from '../../utils/businessHours'
import { bookingSlotsForDay } from '../../utils/bookingSlots'
import { receptionistSlotGroups, type ReceptionistSlotQuery } from '../../utils/receptionistSlots'
import { outsideHoursInZone } from '../../utils/staffQuietHours'

// One day's hours for one person (shift_days, 20261125125008): "open a practitioner's
// calendar on Friday 11 December", a day their week leaves empty, or close a
// Tuesday they normally work. They ride on the hours object under the date
// itself, and every reader that knows the date reads them first --
// assert_booking_slot_open does the same in the database.
describe('One-off days', () => {
  const day = (open: string, close: string): [string, string][] => [[open, close]]
  // A real week shape: no Fridays.
  const week: BusinessHours = { mon: day('15:00', '20:00'), tue: day('15:00', '20:00'), wed: day('09:00', '14:00'), thu: day('15:00', '20:00'), fri: [], sat: [], sun: [] }
  const clinicHours: BusinessHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
  const FRIDAY = '2026-12-11'
  const TUESDAY = '2026-12-15'
  const withFriday = withDayHours(week, [{ day: FRIDAY, ranges: day('09:30', '14:00') }])
  const tuesdayOff = withDayHours(week, [{ day: TUESDAY, ranges: [] }])

  it('opens a day the week leaves empty, and only that date', () => {
    expect(practitionerWindowsForDay([], withFriday, 'fri', FRIDAY)).toEqual(day('09:30', '14:00'))
    expect(practitionerWindowsForDay([], withFriday, 'fri', '2026-12-18')).toEqual([])
    // Without the date, the week as before.
    expect(practitionerWindowsForDay([], withFriday, 'fri')).toEqual([])
  })

  it('closes a day the week works', () => {
    expect(practitionerWindowsForDay([], tuesdayOff, 'tue', TUESDAY)).toEqual([])
    expect(practitionerWindowsForDay([], tuesdayOff, 'tue', '2026-12-22')).toEqual(day('15:00', '20:00'))
  })

  it('is not a week: somebody with no hours of their own keeps the clinic’s on every other day', () => {
    const clinic: BusinessHours = { mon: day('09:00', '20:00'), fri: day('09:00', '20:00') }
    const onlyADay = withDayHours(null, [{ day: FRIDAY, ranges: day('16:00', '18:00') }])
    expect(hasBusinessHoursConfigured(onlyADay)).toBe(false)
    expect(practitionerWindowsForDay(clinic.mon!, onlyADay, 'mon', '2026-12-14')).toEqual(day('09:00', '20:00'))
    expect(practitionerWindowsForDay(clinic.fri!, onlyADay, 'fri', FRIDAY)).toEqual(day('16:00', '18:00'))
  })

  it('leaves the hours untouched when there are no days', () => {
    expect(withDayHours(week, [])).toBe(week)
    expect(withDayHours(null, undefined)).toBe(null)
  })

  it('is merged after the location rule, which does not carry it', () => {
    const merged = withDayHours(practitionerHoursAt('c1', clinicHours, week, null), [{ day: FRIDAY, ranges: day('09:30', '14:00') }])
    expect(merged?.[FRIDAY]).toEqual(day('09:30', '14:00'))
  })

  it('is offered online on that date (bookingSlotsForDay)', () => {
    const slots = (hours: BusinessHours | null, date: string) =>
      bookingSlotsForDay({ date, timeZone: 'Europe/Madrid', clinicHours, practitionerHours: hours, durationMinutes: 30, busy: [], notBefore: new Date('2026-12-01T00:00:00Z') }).map((d) => d.toISOString())
    const friday = slots(withFriday, FRIDAY)
    // 09:30 to 14:00 in half hours: nine starts, 08:30 to 12:30 UTC in December.
    expect(friday.length).toBe(9)
    expect(friday[0]).toBe('2026-12-11T08:30:00.000Z')
    expect(friday[friday.length - 1]).toBe('2026-12-11T12:30:00.000Z')
    expect(slots(week, FRIDAY)).toEqual([])
    expect(slots(tuesdayOff, TUESDAY)).toEqual([])
  })

  it('is open in the calendar on a Date (practitionerWindowsOn, union, out-of-hours)', () => {
    const friday = new Date(2026, 11, 11, 10, 0)
    const fridayEvening = new Date(2026, 11, 11, 16, 0)
    expect(practitionerWindowsOn(friday, clinicHours, withFriday)).toEqual(day('09:30', '14:00'))
    expect(unionWorkingWindows(friday, clinicHours, [withFriday])).toEqual(day('09:30', '14:00'))
    expect(outsideWorkingHours(friday, clinicHours, withFriday)).toBe(false)
    expect(outsideWorkingHours(fridayEvening, clinicHours, withFriday)).toBe(true)
    expect(outsideWorkingHours(friday, clinicHours, week)).toBe(true)
  })

  it('counts as hours set even where nothing else is (hoursKnownOn)', () => {
    const onlyADay = withDayHours(null, [{ day: FRIDAY, ranges: day('09:30', '14:00') }])
    expect(hoursKnownOn(new Date(2026, 11, 11, 10), null, onlyADay)).toBe(true)
    expect(hoursKnownOn(new Date(2026, 11, 18, 10), null, onlyADay)).toBe(false)
    // An unrestricted clinic stays unrestricted on other days.
    expect(unionWorkingWindows(new Date(2026, 11, 18, 10), null, [onlyADay])).toBe(null)
    expect(outsideWorkingHours(new Date(2026, 11, 11, 16), null, onlyADay)).toBe(true)
  })

  it('is offered by the receptionist (receptionistSlotGroups)', () => {
    const weekdays: BusinessHours = { mon: day('09:00', '12:00'), tue: day('09:00', '12:00'), wed: day('09:00', '12:00'), thu: day('09:00', '12:00'), fri: day('09:00', '12:00'), sat: [], sun: [] }
    const noFridays: BusinessHours = { ...weekdays, fri: [] }
    const base: ReceptionistSlotQuery = {
      // Wednesday 9 Dec 2026, 08:00 in Madrid.
      now: new Date('2026-12-09T07:00:00Z'),
      clinics: [{ id: 'c1', name: 'Centro', timeZone: 'Europe/Madrid', businessHours: weekdays }],
      practitioners: [{ id: 'p1', businessHours: noFridays, clinicIds: ['c1'] }],
      types: [{ id: 't1', name: 'Ajuste', durationMinutes: 60 }],
      appointments: [],
      blocks: [],
      bookingWindowDays: 3,
      minimumNoticeMinutes: 0,
    }
    const dates = (q: ReceptionistSlotQuery) => receptionistSlotGroups(q)!.groups.flatMap((g) => g.days.map((d) => d.date))
    expect(dates(base)).not.toContain(FRIDAY)
    const opened: ReceptionistSlotQuery = { ...base, practitioners: [{ ...base.practitioners[0]!, dayHours: [{ day: FRIDAY, ranges: day('09:30', '11:30') }] }] }
    expect(dates(opened)).toContain(FRIDAY)
  })

  it('keeps pushes coming on an extra working day (quiet hours)', () => {
    const fridayMorning = new Date('2026-12-11T09:00:00Z') // 10:00 in Madrid
    expect(outsideHoursInZone(fridayMorning, 'Europe/Madrid', clinicHours, week)).toBe(true)
    expect(outsideHoursInZone(fridayMorning, 'Europe/Madrid', clinicHours, withFriday)).toBe(false)
  })
})
