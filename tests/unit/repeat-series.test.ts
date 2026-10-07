// The calendar reads and writes times in the staff browser's own zone, which
// it takes to be the clinic's (NewAppointmentPanel parses its date and time
// fields with `new Date(`${date}T${time}`)`). Pinned to Madrid here so the
// daylight-saving cases mean the same thing on a laptop in Spain and on a CI
// runner in UTC. Vitest runs each file in its own process, so this reaches
// no other test.
process.env.TZ = 'Europe/Madrid'

import { describe, it, expect } from 'vitest'
import { seriesStarts, seriesProblems } from '../../utils/repeatSeries'

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('A repeating booking keeps its wall-clock time', () => {
  it('stays at 10:00 across the October clock change', () => {
    // Tuesday 20 Oct 2026, 10:00 in Madrid (CEST); the clocks go back on
    // Sunday the 25th. Adding 7 x 24h put every later visit at 09:00.
    const starts = seriesStarts(new Date(2026, 9, 20, 10, 0), { unit: 'week', every: 1, count: 3 })
    expect(starts.map(ymd)).toEqual(['2026-10-20', '2026-10-27', '2026-11-03'])
    expect(starts.map(hhmm)).toEqual(['10:00', '10:00', '10:00'])
  })

  it('stays at 10:00 across the March clock change', () => {
    const starts = seriesStarts(new Date(2027, 2, 23, 10, 0), { unit: 'week', every: 1, count: 2 })
    expect(starts.map(ymd)).toEqual(['2027-03-23', '2027-03-30'])
    expect(starts.map(hhmm)).toEqual(['10:00', '10:00'])
  })
})

describe('Monthly repeats land on the same day of the month', () => {
  it('keeps a Tuesday the 13th on the 13th, not thirty days on', () => {
    const starts = seriesStarts(new Date(2026, 9, 13, 17, 30), { unit: 'month', every: 1, count: 3 })
    expect(starts.map(ymd)).toEqual(['2026-10-13', '2026-11-13', '2026-12-13'])
    expect(starts.map(hhmm)).toEqual(['17:30', '17:30', '17:30'])
  })

  it('clamps the 31st to the last day of a shorter month, then goes back to the 31st', () => {
    const starts = seriesStarts(new Date(2027, 0, 31, 9, 0), { unit: 'month', every: 1, count: 4 })
    expect(starts.map(ymd)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  })

  it('follows a care plan of every two months', () => {
    const starts = seriesStarts(new Date(2026, 10, 30, 12, 0), { unit: 'month', every: 2, count: 3 })
    expect(starts.map(ymd)).toEqual(['2026-11-30', '2027-01-30', '2027-03-30'])
  })

  it('follows a care plan of every two weeks', () => {
    const starts = seriesStarts(new Date(2026, 9, 20, 10, 0), { unit: 'week', every: 2, count: 3 })
    expect(starts.map(ymd)).toEqual(['2026-10-20', '2026-11-03', '2026-11-17'])
  })
})

describe('Daily repeats skip the days nobody is working', () => {
  const weekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6

  it('books eight working days, not a Saturday and a Sunday', () => {
    // Thursday 22 Oct 2026.
    const starts = seriesStarts(new Date(2026, 9, 22, 9, 0), { unit: 'day', every: 1, count: 8, skipDay: weekend })
    expect(starts).toHaveLength(8)
    expect(starts.map(ymd)).toEqual(['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02'])
    expect(starts.every((d) => hhmm(d) === '09:00')).toBe(true)
  })

  it('keeps the first date as chosen, even on a closed day', () => {
    const starts = seriesStarts(new Date(2026, 9, 24, 9, 0), { unit: 'day', every: 1, count: 2, skipDay: weekend })
    expect(starts.map(ymd)).toEqual(['2026-10-24', '2026-10-26'])
  })

  it('gives up rather than looping when every day is closed', () => {
    const starts = seriesStarts(new Date(2026, 9, 22, 9, 0), { unit: 'day', every: 1, count: 8, skipDay: () => true })
    expect(starts).toHaveLength(1)
  })

  it('is one date for a booking that does not repeat', () => {
    expect(seriesStarts(new Date(2026, 9, 22, 9, 0), { unit: 'day', every: 1, count: 1 })).toHaveLength(1)
  })
})

describe('Every date in a series is checked, not just the first', () => {
  const starts = seriesStarts(new Date(2026, 9, 20, 10, 0), { unit: 'week', every: 1, count: 4 })
  const at = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m, d, h, mi).getTime()
  const busy = [{ start: at(2026, 10, 3, 10, 15), end: at(2026, 10, 3, 10, 45), label: 'Clara Vidal' }]
  const nobodyOff = () => false

  it('names the later date that clashes', () => {
    const problems = seriesProblems(starts, 30, busy, nobodyOff)
    expect(problems).toHaveLength(1)
    expect(ymd(problems[0].start)).toBe('2026-11-03')
    expect(problems[0].clash?.label).toBe('Clara Vidal')
    expect(problems[0].outOfHours).toBe(false)
  })

  it('names a later date outside working hours', () => {
    const offOnThe27th = (s: Date) => ymd(s) === '2026-10-27'
    const problems = seriesProblems(starts, 30, [], offOnThe27th)
    expect(problems.map((p) => ymd(p.start))).toEqual(['2026-10-27'])
    expect(problems[0].outOfHours).toBe(true)
  })

  it('lets the first date overlap when double booking was asked for, and still reports the others', () => {
    const first = [{ start: at(2026, 9, 20, 10), end: at(2026, 9, 20, 10, 30), label: 'Ana' }, ...busy]
    const problems = seriesProblems(starts, 30, first, nobodyOff, { overlapAllowedAt: [0] })
    expect(problems.map((p) => ymd(p.start))).toEqual(['2026-11-03'])
  })

  it('has nothing to say about a series that fits', () => {
    expect(seriesProblems(starts, 30, [], nobodyOff)).toEqual([])
  })
})
