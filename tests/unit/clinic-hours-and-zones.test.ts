import { describe, it, expect } from 'vitest'
import { normalizeHours, hoursProblems, dayRangesText, copyMondayToWeekdays } from '../../utils/clinicHours'
import { utcOffsetLabel, zoneFromId, searchZones, FREQUENT_ZONES } from '../../utils/timeZones'

// Settings -> Clinics edits clinics.business_hours in place. The calendar,
// the booking page, the public API and practitionerWindowsForDay read that
// same object, so the editor must hand back exactly its shape.
describe('A clinic\'s opening hours in the editor', () => {
  it('fills in every day and keeps each day\'s ranges in order', () => {
    const out = normalizeHours({ mon: [['16:00', '20:00'], ['09:00', '14:00']] })
    expect(Object.keys(out)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    expect(out.mon).toEqual([['09:00', '14:00'], ['16:00', '20:00']])
    expect(out.sun).toEqual([])
  })

  it('treats a stored null as all days closed rather than crashing', () => {
    expect(normalizeHours(null).wed).toEqual([])
  })

  it('refuses a range that ends before it starts, and ranges that overlap', () => {
    const hours = normalizeHours({ mon: [['14:00', '09:00']], tue: [['09:00', '14:00'], ['13:00', '18:00']], wed: [['09:00', '14:00'], ['14:00', '18:00']] })
    const problems = hoursProblems(hours)
    expect(problems.mon).toBe('backwards')
    expect(problems.tue).toBe('overlap')
    // Touching is not overlapping: 9-14 then 14-18 is one long day.
    expect(problems.wed).toBeUndefined()
  })

  it('refuses a half-typed time', () => {
    expect(hoursProblems(normalizeHours({ fri: [['09:00', '']] })).fri).toBe('incomplete')
  })

  it('reads a day back the way the clinic list shows it', () => {
    const hours = normalizeHours({ mon: [['09:00', '14:00'], ['16:00', '20:00']] })
    expect(dayRangesText(hours, 'mon', 'y')).toBe('9:00–14:00 y 16:00–20:00')
    expect(dayRangesText(hours, 'sun', 'y')).toBeNull()
  })

  it('copies Monday onto Tuesday to Friday without sharing the arrays', () => {
    const hours = copyMondayToWeekdays(normalizeHours({ mon: [['09:00', '14:00']], sat: [['10:00', '13:00']] }))
    expect(hours.fri).toEqual([['09:00', '14:00']])
    expect(hours.sat).toEqual([['10:00', '13:00']])
    hours.tue[0][1] = '15:00'
    expect(hours.mon[0][1]).toBe('14:00')
  })
})

describe('Time zones for a clinic anywhere', () => {
  it('names the offset at the moment asked, summer time included', () => {
    expect(utcOffsetLabel('Europe/Madrid', new Date('2026-07-01T12:00:00Z'))).toBe('UTC+2')
    expect(utcOffsetLabel('Europe/Madrid', new Date('2026-01-15T12:00:00Z'))).toBe('UTC+1')
    expect(utcOffsetLabel('Atlantic/Canary', new Date('2026-01-15T12:00:00Z'))).toBe('UTC')
    expect(utcOffsetLabel('America/Bogota', new Date('2026-01-15T12:00:00Z'))).toBe('UTC−5')
    expect(utcOffsetLabel('Asia/Kolkata', new Date('2026-01-15T12:00:00Z'))).toBe('UTC+5:30')
  })

  it('makes a readable name out of any zone id', () => {
    expect(zoneFromId('America/Argentina/Buenos_Aires').city).toBe('Buenos Aires')
    expect(zoneFromId('Asia/Ho_Chi_Minh')).toEqual({ id: 'Asia/Ho_Chi_Minh', city: 'Ho Chi Minh', region: 'Asia' })
  })

  it('finds a zone however it is typed, accents or not', () => {
    expect(searchZones(FREQUENT_ZONES, 'bogota').map((z) => z.id)).toEqual(['America/Bogota'])
    expect(searchZones(FREQUENT_ZONES, 'CANARIAS').map((z) => z.id)).toEqual(['Atlantic/Canary'])
    expect(searchZones(FREQUENT_ZONES, '').length).toBe(FREQUENT_ZONES.length)
  })
})
