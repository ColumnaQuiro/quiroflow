import { describe, expect, it } from 'vitest'
import { formatShift, leaveWorkingDays, parseShift, shiftForDay, shiftGaps, shiftMinutes } from '../../utils/staffShifts'

// Shifts and leave (utils/staffShifts.ts).
const clinic = { mon: [['09:00', '20:00']], sat: [] } as never
describe('shiftForDay', () => {
  it('takes a day changed by the owner, then their own week, then the clinic for a practitioner', () => {
    const own = { business_hours: { mon: [['10:00', '14:00'], ['16:00', '20:00']] }, is_practitioner: true } as never
    expect(shiftForDay('2026-10-26', own, clinic, [['09:00', '13:00']])).toEqual([['09:00', '13:00']])
    expect(shiftForDay('2026-10-26', own, clinic)).toEqual([['10:00', '14:00'], ['16:00', '20:00']])
    expect(shiftForDay('2026-10-26', { business_hours: null, is_practitioner: true }, clinic)).toEqual([['09:00', '20:00']])
    // Front desk with no hours yet: no shift, not "off".
    expect(shiftForDay('2026-10-26', { business_hours: null, is_practitioner: false }, clinic)).toBeNull()
    // A day override of [] is a day off.
    expect(shiftForDay('2026-10-26', own, clinic, [])).toEqual([])
  })
})

describe('shift text', () => {
  it('reads and writes the hours', () => {
    expect(parseShift('9:00-14:00, 16:00-19:00')).toEqual([['09:00', '14:00'], ['16:00', '19:00']])
    expect(parseShift('')).toEqual([])
    expect(parseShift('14:00-09:00')).toBeNull()
    expect(parseShift('mañana')).toBeNull()
    expect(formatShift([['09:00', '14:00'], ['16:00', '19:00']])).toBe('09:00–14:00 · 16:00–19:00')
    expect(shiftMinutes([['09:00', '14:00'], ['16:00', '19:00']])).toBe(8 * 60)
  })
})

describe('shiftGaps', () => {
  it('flags only gaps past 15 minutes', () => {
    expect(shiftGaps([['08:30', '14:30']], '09:10', '14:35')).toEqual({ in: 40, out: null })
    expect(shiftGaps([['10:00', '14:00'], ['16:00', '20:00']], '09:55', '20:45')).toEqual({ in: null, out: 45 })
    expect(shiftGaps([], '09:00', '17:00')).toEqual({ in: null, out: null })
  })
})

describe('leaveWorkingDays', () => {
  it('counts Monday to Friday, less clinic closures, half a day as half', () => {
    expect(leaveWorkingDays('2026-11-23', '2026-11-27', false)).toBe(5)
    expect(leaveWorkingDays('2026-11-27', '2026-11-30', false)).toBe(2) // Fri + Mon
    expect(leaveWorkingDays('2026-12-07', '2026-12-09', false, new Set(['2026-12-08']))).toBe(2)
    expect(leaveWorkingDays('2026-11-25', '2026-11-25', true)).toBe(0.5)
  })
})
