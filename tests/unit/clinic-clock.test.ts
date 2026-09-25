import { describe, it, expect } from 'vitest'
import { localDay, nextDate, startOfLocalDate, wallClock, zoneOffsetMinutes } from '../../utils/clinicClock'

// The same-day automation runs at 9:00 where each clinic is, over that
// clinic's own day (server/api/automations/same-day-cron.post.ts).
describe('A clinic\'s own local time', () => {
  const now = new Date('2026-07-15T07:10:00Z')

  it('reads the wall clock in the clinic\'s zone', () => {
    expect(wallClock(now, 'Europe/Madrid')).toMatchObject({ hour: 9, minute: 10 })
    expect(wallClock(now, 'Atlantic/Canary')).toMatchObject({ hour: 8, minute: 10 })
    expect(wallClock(now, 'America/Bogota')).toMatchObject({ hour: 2, minute: 10 })
  })

  it('gives each clinic its own today', () => {
    const madrid = localDay(now, 'Europe/Madrid')
    expect(madrid.start.toISOString()).toBe('2026-07-14T22:00:00.000Z')
    expect(madrid.end.toISOString()).toBe('2026-07-15T22:00:00.000Z')
    expect(localDay(now, 'Atlantic/Canary').start.toISOString()).toBe('2026-07-14T23:00:00.000Z')
    expect(localDay(now, 'America/Bogota').start.toISOString()).toBe('2026-07-15T05:00:00.000Z')
  })

  it('stays right in winter, after the clocks change', () => {
    expect(localDay(new Date('2026-01-15T10:00:00Z'), 'Europe/Madrid').start.toISOString()).toBe('2026-01-14T23:00:00.000Z')
  })

  it('falls back to Madrid when a clinic has no zone', () => {
    expect(wallClock(now, '')).toMatchObject({ hour: 9 })
  })
})

// Settings -> Clinics -> Cierres y festivos stores a closure as whole local
// days: from the first day's midnight to the midnight after the last.
describe('Whole days at a clinic, as instants', () => {
  it('starts a date at local midnight, summer or winter', () => {
    expect(startOfLocalDate('2026-08-15', 'Europe/Madrid').toISOString()).toBe('2026-08-14T22:00:00.000Z')
    expect(startOfLocalDate('2026-12-25', 'Europe/Madrid').toISOString()).toBe('2026-12-24T23:00:00.000Z')
    expect(startOfLocalDate('2026-12-25', 'Atlantic/Canary').toISOString()).toBe('2026-12-25T00:00:00.000Z')
    expect(startOfLocalDate('2026-12-25', 'America/Mexico_City').toISOString()).toBe('2026-12-25T06:00:00.000Z')
  })
  it('gets the day the clocks go forward right', () => {
    // 29 Mar 2026: Madrid goes from +1 to +2 at 02:00; midnight is still +1.
    expect(startOfLocalDate('2026-03-29', 'Europe/Madrid').toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(startOfLocalDate('2026-03-30', 'Europe/Madrid').toISOString()).toBe('2026-03-29T22:00:00.000Z')
  })
  it('steps to the next date across month and year ends', () => {
    expect(nextDate('2026-12-31')).toBe('2027-01-01')
    expect(nextDate('2026-02-28')).toBe('2026-03-01')
  })
  it('knows a zone\'s offset', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Europe/Madrid')).toBe(120)
    expect(zoneOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'America/Bogota')).toBe(-300)
  })
})
