import { describe, it, expect } from 'vitest'
import { gridHourOf, gridLinearTops, gridMinuteAt, gridRowsPerHour, gridStackRows, gridStretchedTops, gridYAt } from '../../utils/calendarRows'

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
    // Alone in a 150px hour, 09:30 is half way down it (less its row).
    expect(gridStackRows([90], tops, 30)).toEqual([150 + 0.5 * 120])
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
