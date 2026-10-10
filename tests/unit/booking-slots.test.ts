import { describe, it, expect } from 'vitest'
import { bookingSlotsForDay, calendarDateKey, clinicHourOf, clinicTimeLabel, staffDayTimes, weekdayKeyOf } from '../../utils/bookingSlots'
import { clinicDateOf, wallClockToUtc } from '../../utils/clinicClock'

// The slots the booking page and the patient app offer (utils/bookingSlots.ts).
//
// Both screens built them with Date#setHours, in the DEVICE's zone, and the app
// read only the clinic's hours: no practitioner hours, no blocks, and a move
// offered times inside the notice the reschedule function then refused.
describe('Online booking slots', () => {
  const weekdays = { mon: [['09:00', '12:00']], tue: [['09:00', '12:00']], wed: [['09:00', '12:00']], thu: [['09:00', '12:00']], fri: [['09:00', '12:00']], sat: [], sun: [] } as Record<string, [string, string][]>
  const longAgo = new Date('2020-01-01T00:00:00Z')
  const base = { timeZone: 'Europe/Madrid', clinicHours: weekdays, practitionerHours: null, durationMinutes: 60, busy: [], notBefore: longAgo }
  const iso = (d: Date[]) => d.map((x) => x.toISOString())

  it("reads the hours on the clinic's clock, not the device's", () => {
    // Monday 5 Oct 2026, Madrid in summer time (UTC+2): 09:00 there is 07:00Z,
    // whatever zone this runs in.
    expect(iso(bookingSlotsForDay({ ...base, date: '2026-10-05' }))).toEqual([
      '2026-10-05T07:00:00.000Z',
      '2026-10-05T08:00:00.000Z',
      '2026-10-05T09:00:00.000Z',
    ])
    // And after the clocks go back (UTC+1).
    expect(iso(bookingSlotsForDay({ ...base, date: '2026-11-02' }))[0]).toBe('2026-11-02T08:00:00.000Z')
    // A clinic in the Canaries is an hour behind Madrid.
    expect(iso(bookingSlotsForDay({ ...base, timeZone: 'Atlantic/Canary', date: '2026-10-05' }))[0]).toBe('2026-10-05T08:00:00.000Z')
  })

  it("shows them on the clinic's clock", () => {
    const [first] = bookingSlotsForDay({ ...base, date: '2026-10-05' })
    expect(clinicTimeLabel(first, 'Europe/Madrid')).toBe('09:00')
    expect(clinicHourOf(first, 'Europe/Madrid')).toBe(9)
  })

  it("takes the weekday from the date, not from the device's day", () => {
    expect(weekdayKeyOf('2026-10-05')).toBe('mon')
    expect(weekdayKeyOf('2026-10-04')).toBe('sun')
    expect(bookingSlotsForDay({ ...base, date: '2026-10-04' })).toEqual([])
    expect(calendarDateKey(new Date(2026, 9, 5))).toBe('2026-10-05')
  })

  it("uses the practitioner's own week once they have one, and their empty day is a day off", () => {
    const mondaysOnly = { mon: [['15:00', '17:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } as Record<string, [string, string][]>
    expect(iso(bookingSlotsForDay({ ...base, date: '2026-10-05', practitionerHours: mondaysOnly }))).toEqual(['2026-10-05T13:00:00.000Z', '2026-10-05T14:00:00.000Z'])
    expect(bookingSlotsForDay({ ...base, date: '2026-10-06', practitionerHours: mondaysOnly })).toEqual([])
  })

  it('leaves out what is busy or blocked', () => {
    const busy = [{ starts_at: '2026-10-05T07:30:00.000Z', ends_at: '2026-10-05T08:15:00.000Z' }]
    expect(iso(bookingSlotsForDay({ ...base, date: '2026-10-05', busy }))).toEqual(['2026-10-05T09:00:00.000Z'])
  })

  it('offers nothing before notBefore or after notAfter -- the notice window and the horizon', () => {
    const slots = bookingSlotsForDay({ ...base, date: '2026-10-05', notBefore: new Date('2026-10-05T07:00:00Z'), notAfter: new Date('2026-10-05T08:00:00Z') })
    expect(iso(slots)).toEqual(['2026-10-05T08:00:00.000Z'])
  })

  it('keeps the whole visit inside the window', () => {
    expect(iso(bookingSlotsForDay({ ...base, date: '2026-10-05', durationMinutes: 100 }))).toEqual(['2026-10-05T07:00:00.000Z'])
  })
})

describe('Wall-clock times at the clinic', () => {
  it('turns a date and a time into the instant, across daylight saving', () => {
    expect(new Date(wallClockToUtc('2026-07-15', '09:00', 'Europe/Madrid')).toISOString()).toBe('2026-07-15T07:00:00.000Z')
    expect(new Date(wallClockToUtc('2026-01-15', '09:00', 'Europe/Madrid')).toISOString()).toBe('2026-01-15T08:00:00.000Z')
    // The day the clocks go forward (29 Mar 2026, 02:00 -> 03:00).
    expect(new Date(wallClockToUtc('2026-03-29', '10:00', 'Europe/Madrid')).toISOString()).toBe('2026-03-29T08:00:00.000Z')
    expect(new Date(wallClockToUtc('2026-07-15', '09:00', 'America/Mexico_City')).toISOString()).toBe('2026-07-15T15:00:00.000Z')
  })

  it("names the clinic's date, which near midnight is not the device's", () => {
    expect(clinicDateOf(new Date('2026-10-05T22:30:00Z'), 'Europe/Madrid')).toBe('2026-10-06')
    expect(clinicDateOf(new Date('2026-10-05T22:30:00Z'), 'Atlantic/Canary')).toBe('2026-10-05')
  })
})

// The staff app's book and move sheets list every time of the day, the taken
// and out-of-hours ones marked rather than left out: the desk books over them
// on purpose (staffDayTimes).
describe('Every time of the day, for staff', () => {
  const weekdays = { mon: [['09:00', '12:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } as Record<string, [string, string][]>
  const base = { timeZone: 'Europe/Madrid', clinicHours: weekdays, practitionerHours: null, durationMinutes: 60, busy: [], notBefore: new Date('2020-01-01T00:00:00Z') }
  const label = (list: { at: Date; state: string }[]) => list.map((x) => `${clinicTimeLabel(x.at, 'Europe/Madrid')} ${x.state}`)

  it('marks taken times and times outside the hours, and keeps the free ones', () => {
    // A visit 10:00-11:00 on Monday 5 Oct.
    const busy = [{ starts_at: '2026-10-05T08:00:00Z', ends_at: '2026-10-05T09:00:00Z' }]
    const times = label(staffDayTimes({ ...base, date: '2026-10-05', busy, latest: '13:00' }))
    expect(times).toEqual(['08:00 closed', '09:00 free', '10:00 busy', '11:00 free', '12:00 closed'])
    // The free ones are exactly what a patient would be offered.
    const free = staffDayTimes({ ...base, date: '2026-10-05', busy }).filter((x) => x.state === 'free').map((x) => x.at.toISOString())
    expect(free).toEqual(bookingSlotsForDay({ ...base, date: '2026-10-05', busy }).map((d) => d.toISOString()))
  })

  it('lists a day nobody works, all of it outside the hours', () => {
    const times = staffDayTimes({ ...base, date: '2026-10-06', latest: '11:00' })
    expect(label(times)).toEqual(['08:00 closed', '09:00 closed', '10:00 closed'])
  })

  it('adds a start off the grid, marked by the same rule', () => {
    const extra = [new Date(wallClockToUtc('2026-10-05', '09:15', 'Europe/Madrid'))]
    const times = label(staffDayTimes({ ...base, date: '2026-10-05', extra, latest: '12:00' }))
    expect(times).toContain('09:15 free')
  })

  it('leaves out times already past', () => {
    const notBefore = new Date(wallClockToUtc('2026-10-05', '10:30', 'Europe/Madrid'))
    expect(label(staffDayTimes({ ...base, date: '2026-10-05', notBefore, latest: '12:00' }))).toEqual(['11:00 free'])
  })
})
