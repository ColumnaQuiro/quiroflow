import { describe, it, expect } from 'vitest'
import { practitionerHoursAt, practitionerWindowsForDay, wholeWeek, type BusinessHours } from '../../utils/businessHours'
import { bookingSlotsForDay } from '../../utils/bookingSlots'

// The week somebody works at ONE location (utils/businessHours.ts
// practitionerHoursAt, 20261119124321_hours_per_location.sql).
//
// A practitioner had one week wherever they were. Somebody at the clinic all
// week and at a gym two evenings was offered at the gym every morning: their
// own hours are authoritative, so the gym's opening hours never applied.
describe('Hours per location', () => {
  const day = (open: string, close: string): [string, string][] => [[open, close]]
  const week = (windows: [string, string][]): BusinessHours => ({ mon: windows, tue: windows, wed: windows, thu: windows, fri: windows })
  const CLINIC = 'clinic'
  const GYM = 'gym'
  const clinicHours = week(day('09:00', '20:00'))
  const gymHours: BusinessHours = { tue: day('17:00', '20:00'), thu: day('17:00', '20:00') }
  const own = week(day('09:00', '20:00'))
  const atGym = [{ clinic_id: CLINIC, business_hours: null }, { clinic_id: GYM, business_hours: gymHours }]
  const windows = (clinicId: string, hours: BusinessHours, member: BusinessHours | null, locations: typeof atGym | null, dayKey: string) =>
    practitionerWindowsForDay(hours[dayKey] ?? [], practitionerHoursAt(clinicId, hours, member, locations), dayKey)

  it('changes nothing for somebody with no week per location', () => {
    expect(practitionerHoursAt(CLINIC, clinicHours, own, null)).toBe(own)
    expect(practitionerHoursAt(CLINIC, clinicHours, own, [{ clinic_id: CLINIC, business_hours: null }, { clinic_id: GYM, business_hours: null }])).toBe(own)
    expect(practitionerHoursAt(CLINIC, clinicHours, null, [{ clinic_id: GYM, business_hours: { mon: [], tue: [] } }])).toBe(null)
  })

  it('offers them at the second location only in the week set for it', () => {
    expect(windows(GYM, gymHours, own, atGym, 'tue')).toEqual(day('17:00', '20:00'))
    // The bug: their own Wednesday used to be read here.
    expect(windows(GYM, gymHours, own, atGym, 'wed')).toEqual([])
  })

  it('takes that time out of their hours everywhere else, without anyone carving it out', () => {
    expect(windows(CLINIC, clinicHours, own, atGym, 'tue')).toEqual(day('09:00', '17:00'))
    expect(windows(CLINIC, clinicHours, own, atGym, 'wed')).toEqual(day('09:00', '20:00'))
  })

  it('does the same for somebody with no hours of their own, who works the location’s', () => {
    expect(windows(CLINIC, clinicHours, null, atGym, 'thu')).toEqual(day('09:00', '17:00'))
    expect(windows(CLINIC, clinicHours, null, atGym, 'mon')).toEqual(day('09:00', '20:00'))
  })

  it('splits a day around the middle of it spent elsewhere', () => {
    const lunchtimeClass = [{ clinic_id: GYM, business_hours: { mon: day('12:00', '14:00') } as BusinessHours }]
    expect(windows(CLINIC, clinicHours, own, lunchtimeClass, 'mon')).toEqual([['09:00', '12:00'], ['14:00', '20:00']])
  })

  it('lets a week set for this location stand, whatever is set for the others', () => {
    const both = [{ clinic_id: CLINIC, business_hours: { tue: day('09:00', '18:00') } as BusinessHours }, { clinic_id: GYM, business_hours: gymHours }]
    expect(windows(CLINIC, clinicHours, own, both, 'tue')).toEqual(day('09:00', '18:00'))
    expect(windows(CLINIC, clinicHours, own, both, 'mon')).toEqual([])
  })

  it('is never here when every hour they work is spent at the other location, rather than falling back to the location’s hours', () => {
    const allWeekAtGym = [{ clinic_id: GYM, business_hours: week(day('08:00', '21:00')) }]
    for (const dayKey of ['mon', 'tue', 'wed', 'thu', 'fri']) expect(windows(CLINIC, clinicHours, null, allWeekAtGym, dayKey)).toEqual([])
  })

  it('reaches the slots a patient is offered', () => {
    // Tuesday 24 Nov 2026, Madrid (UTC+1).
    const slots = (clinicId: string, hours: BusinessHours, date: string) =>
      bookingSlotsForDay({ date, timeZone: 'Europe/Madrid', clinicHours: hours, practitionerHours: practitionerHoursAt(clinicId, hours, own, atGym), durationMinutes: 60, busy: [], notBefore: new Date('2020-01-01T00:00:00Z') }).map((d) => d.toISOString())
    expect(slots(GYM, gymHours, '2026-11-24')).toEqual(['2026-11-24T16:00:00.000Z', '2026-11-24T17:00:00.000Z', '2026-11-24T18:00:00.000Z'])
    expect(slots(GYM, gymHours, '2026-11-25')).toEqual([])
    expect(slots(CLINIC, clinicHours, '2026-11-24').at(-1)).toBe('2026-11-24T15:00:00.000Z')
  })
})

// What is about the person rather than one location: their shift against what
// they clocked, holiday days, push quiet hours (wholeWeek).
describe('The whole week somebody works', () => {
  const usual: BusinessHours = { mon: [['09:00', '14:00']], tue: [['09:00', '14:00']] }
  const gym = [{ business_hours: { tue: [['17:00', '20:00']], sat: [['10:00', '12:00']] } as BusinessHours }]

  it('is their usual hours when no location has a week of its own', () => {
    expect(wholeWeek(null, usual, null)).toBe(usual)
    expect(wholeWeek(null, usual, [{ business_hours: null }])).toBe(usual)
    expect(wholeWeek(null, null, [])).toBe(null)
  })

  it('adds the week set for a location to their usual hours', () => {
    expect(wholeWeek(null, usual, gym)).toEqual({ mon: [['09:00', '14:00']], tue: [['09:00', '14:00'], ['17:00', '20:00']], sat: [['10:00', '12:00']] })
  })

  it('folds a location that overlaps their usual hours into one stretch', () => {
    expect(wholeWeek(null, usual, [{ business_hours: { tue: [['13:00', '16:00']] } }])?.tue).toEqual([['09:00', '16:00']])
  })

  it('starts from the clinic’s hours for a practitioner with none of their own', () => {
    expect(wholeWeek({ wed: [['08:00', '12:00']] }, null, gym)).toEqual({ tue: [['17:00', '20:00']], wed: [['08:00', '12:00']], sat: [['10:00', '12:00']] })
  })
})
