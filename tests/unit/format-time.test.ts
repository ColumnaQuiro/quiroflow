import { describe, expect, it } from 'vitest'
import { formatTime } from '../../utils/billing'

// formatTime reuses one Intl.DateTimeFormat instead of calling
// toLocaleTimeString per call. The two differ on one input: format() throws on
// an invalid date, and the booking form hands it one while a time is half
// typed -- which took the whole panel down.
describe('formatTime', () => {
  it('writes 24-hour hh:mm', () => {
    const d = new Date(2026, 8, 28, 9, 5)
    expect(formatTime(d)).toBe('09:05')
    expect(formatTime(d.toISOString())).toBe('09:05')
    expect(formatTime(new Date(2026, 8, 28, 18, 30))).toBe('18:30')
  })

  it('does not throw on an invalid date', () => {
    expect(formatTime('2026-09-28T')).toBe('Invalid Date')
    expect(formatTime(new Date(Number.NaN))).toBe('Invalid Date')
  })
})
