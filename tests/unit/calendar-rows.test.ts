import { describe, it, expect } from 'vitest'
import { gridEndHour, gridHourOf, gridLinearTops, gridMinuteAt, gridRowsPerHour, gridStackRows, gridStretchedTops, gridYAt } from '../../utils/calendarRows'

// The calendar's vertical scale (utils/calendarRows): the linear grid it has
// always drawn, and rows mode, where an hour grows to fit the visits stacked
// in it.

const HOURS = 12 // 08:00-20:00

describe('linear scale', () => {
  const tops = gridLinearTops(HOURS, 150)

  it('puts every minute where hours x hourPx did', () => {
    expect(gridYAt(tops, 0)).toBe(0)
    expect(gridYAt(tops, 90)).toBe(225)
    expect(gridYAt(tops, HOURS * 60)).toBe(HOURS * 150)
    expect(tops[tops.length - 1]).toBe(HOURS * 150)
  })

  it('carries on past either end, so a visit before opening keeps its length', () => {
    expect(gridYAt(tops, -30)).toBe(-75)
    expect(gridYAt(tops, HOURS * 60 + 30)).toBe(HOURS * 150 + 75)
  })

  it('maps a y back to the minute it came from', () => {
    for (const m of [0, 15, 59, 60, 61, 405, HOURS * 60 - 1]) expect(gridMinuteAt(tops, gridYAt(tops, m))).toBeCloseTo(m)
    // A drag above the grid: a negative minute, as the old px/hourPx gave.
    expect(gridMinuteAt(tops, -75)).toBeCloseTo(-30)
  })
})

describe('rows mode', () => {
  it('counts the visits starting in each hour, edges folded into the first and last', () => {
    expect(gridRowsPerHour([0, 0, 30, 60, -15, HOURS * 60 + 5], HOURS)).toEqual([4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(gridHourOf(-1, HOURS)).toBe(0)
    expect(gridHourOf(HOURS * 60, HOURS)).toBe(HOURS - 1)
  })

  it('grows an hour only when its rows do not fit', () => {
    const rows = [10, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const tops = gridStretchedTops(150, rows, 30)
    expect(tops[1] - tops[0]).toBe(300) // ten rows of 30
    expect(tops[2] - tops[1]).toBe(150) // two rows fit the floor
    expect(tops[tops.length - 1]).toBe(300 + 11 * 150)
    // The minute <-> y mapping holds across a stretched hour.
    for (const m of [0, 30, 59, 60, 75, 200]) expect(gridMinuteAt(tops, gridYAt(tops, m))).toBeCloseTo(m)
  })

  it('stacks ten visits at 09:00 one under the other, none overlapping', () => {
    const starts = Array.from({ length: 10 }, () => 60)
    const tops = gridStretchedTops(150, gridRowsPerHour(starts, HOURS), 30)
    const rows = gridStackRows(starts, tops, 30)
    expect(rows).toEqual(rows.map((_, i) => tops[1] + i * 30))
    expect(rows[9] + 30).toBeLessThanOrEqual(tops[2])
  })

  it('keeps a visit at its own time when the hour has room', () => {
    const tops = gridStretchedTops(150, gridRowsPerHour([90], HOURS), 30)
    // Alone in a 150px hour, 09:30 is on the 09:30 line the time column
    // labels -- not a row's height above it, which read as 09:22.
    expect(gridStackRows([90], tops, 30)).toEqual([gridYAt(tops, 90)])
  })

  it('puts every visit on its own line when they do not touch', () => {
    // 19:00, 19:30 and 19:45 in one room, the hour stretched by another
    // room busier than this one: each on the line labelled with its time.
    const starts = [11 * 60, 11 * 60 + 30, 11 * 60 + 45]
    const tops = gridStretchedTops(150, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7], 30)
    expect(gridStackRows(starts, tops, 30)).toEqual(starts.map((m) => gridYAt(tops, m)))
  })

  it('pushes a row down only as far as the one above it ends', () => {
    const tops = gridLinearTops(HOURS, 150)
    // 09:00 and 09:05: the second cannot sit at 09:05 (12.5px down) under a
    // 30px row, so it goes straight below it.
    expect(gridStackRows([60, 65], tops, 30)).toEqual([150, 180])
  })

  it('pulls a row late in the hour up so it still ends inside it', () => {
    const tops = gridLinearTops(HOURS, 150)
    // 09:50 would end at 09:50 + a 30px row = past 10:00.
    expect(gridStackRows([110], tops, 30)).toEqual([300 - 30])
    expect(gridStackRows([100, 110], tops, 30)).toEqual([300 - 60, 300 - 30])
  })

  it('closes rows up in a full hour, still in start order and inside the hour', () => {
    const starts = [60, 75, 90, 105, 105, 110]
    const tops = gridStretchedTops(150, gridRowsPerHour(starts, HOURS), 30)
    const rows = gridStackRows(starts, tops, 30)
    for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(30)
    expect(rows[rows.length - 1] + 30).toBeLessThanOrEqual(tops[2])
    expect(rows[0]).toBe(tops[1])
  })

  it('lets a dragged-in row overflow a held scale rather than throw', () => {
    const tops = gridLinearTops(HOURS, 60)
    const rows = gridStackRows([0, 0, 0], tops, 30)
    expect(rows).toEqual([0, 30, 60])
  })
})

// Where the grid ends: a fixed 20:00 hid a clinic's last half hour (open
// until 20:30) and every visit booked from 20:00 on.
describe('gridEndHour', () => {
  it('stays at 20:00 when nothing goes later', () => {
    expect(gridEndHour(['13:00', '19:30'], [19 * 60 + 45])).toBe(20)
    expect(gridEndHour([], [])).toBe(20)
  })

  it('reaches the latest closing time, rounded up to the hour', () => {
    expect(gridEndHour(['13:00', '20:30'], [])).toBe(21)
    expect(gridEndHour(['21:00'], [])).toBe(21)
  })

  it('reaches the latest visit on screen, even past closing', () => {
    expect(gridEndHour(['20:30'], [21 * 60 + 30])).toBe(22)
  })

  it('stops at midnight for a visit that runs past it', () => {
    expect(gridEndHour([], [24 * 60])).toBe(24)
    expect(gridEndHour([], [25 * 60])).toBe(24)
  })

  it('ignores a malformed closing time', () => {
    expect(gridEndHour(['', 'abc'], [])).toBe(20)
  })
})
