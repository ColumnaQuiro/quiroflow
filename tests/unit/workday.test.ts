import { describe, expect, it } from 'vitest'
import { workdaySummary, workdaysOf, formatWorked, workdayWeekStart, workdayMonthBounds, workdayClock } from '../../utils/workday'

// Registro de jornada: how a day's clock entries add up (utils/workday.ts),
// the one reading My Day, My month, the team page and the export share.
const e = (id: string, kind: string, hhmm: string, work_date = '2026-10-20', day = work_date) => ({ id, kind, at: `${day}T${hhmm}:00Z`, work_date })
const later = new Date('2026-10-21T08:00:00Z')

describe('workdaySummary', () => {
  it('counts in to out, less the breaks', () => {
    const d = workdaySummary('2026-10-20', [e('1', 'in', '07:00'), e('2', 'break_start', '11:00'), e('3', 'break_end', '11:30'), e('4', 'out', '15:15')], later)
    expect(d.workedMinutes).toBe(7 * 60 + 45)
    expect(d.breaks).toEqual([{ start: '2026-10-20T11:00:00Z', end: '2026-10-20T11:30:00Z' }])
    expect(d.open).toBe(false)
    expect(d.state).toBe('off')
    expect(d.lastOut).toBe('2026-10-20T15:15:00Z')
  })

  it('adds up a split shift', () => {
    const d = workdaySummary('2026-10-20', [e('1', 'in', '07:00'), e('2', 'out', '11:00'), e('3', 'in', '14:00'), e('4', 'out', '17:30')], later)
    expect(d.workedMinutes).toBe(7 * 60 + 30)
    expect(d.firstIn).toBe('2026-10-20T07:00:00Z')
  })

  it('counts a day still going up to now, and stops counting during a break', () => {
    const now = new Date('2026-10-20T10:30:00Z')
    const working = workdaySummary('2026-10-20', [e('1', 'in', '07:00')], now)
    expect(working.state).toBe('working')
    expect(working.workedMinutes).toBe(210)
    const onBreak = workdaySummary('2026-10-20', [e('1', 'in', '07:00'), e('2', 'break_start', '10:00')], now)
    expect(onBreak.state).toBe('on_break')
    expect(onBreak.workedMinutes).toBe(180)
  })

  it('ends a break left open at the salida', () => {
    const d = workdaySummary('2026-10-20', [e('1', 'in', '07:00'), e('2', 'break_start', '11:00'), e('3', 'out', '12:00')], later)
    expect(d.workedMinutes).toBe(240)
    expect(d.breaks[0]!.end).toBe('2026-10-20T12:00:00Z')
  })

  it('does not count a forgotten salida as hours worked', () => {
    const d = workdaySummary('2026-10-20', [e('1', 'in', '07:00')], new Date('2026-10-21T07:00:00Z'))
    expect(d.missingOut).toBe(true)
    expect(d.state).toBe('off')
    expect(d.workedMinutes).toBe(0)
  })

  it('keeps a salida after midnight on the day it closes', () => {
    const d = workdaySummary('2026-10-20', [e('1', 'in', '18:00'), e('2', 'out', '01:00', '2026-10-20', '2026-10-21')], later)
    expect(d.workedMinutes).toBe(7 * 60)
  })
})

describe('workday helpers', () => {
  it('groups by work_date, newest first', () => {
    const days = workdaysOf([e('1', 'in', '07:00', '2026-10-19'), e('2', 'out', '15:00', '2026-10-19'), e('3', 'in', '07:00', '2026-10-20'), e('4', 'out', '08:00', '2026-10-20')], later)
    expect(days.map((d) => [d.date, d.workedMinutes])).toEqual([['2026-10-20', 60], ['2026-10-19', 480]])
  })

  it('formats hours the way a timesheet does', () => {
    expect(formatWorked(0)).toBe('0 h 00')
    expect(formatWorked(465)).toBe('7 h 45')
    expect(formatWorked(5800)).toBe('96 h 40')
  })

  it('finds the Monday and the month', () => {
    expect(workdayWeekStart('2026-10-25')).toBe('2026-10-19') // a Sunday
    expect(workdayWeekStart('2026-10-19')).toBe('2026-10-19')
    expect(workdayMonthBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' })
    expect(workdayMonthBounds('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' })
  })

  it('reads the clock in the clinic time zone', () => {
    expect(workdayClock('2026-10-20T06:52:00Z', 'Europe/Madrid')).toBe('08:52')
    expect(workdayClock('2026-10-20T06:52:00Z', 'Atlantic/Canary')).toBe('07:52')
  })
})
