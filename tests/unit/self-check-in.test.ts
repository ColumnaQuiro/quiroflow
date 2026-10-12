import { describe, expect, it } from 'vitest'
import { canSelfCheckIn } from '../../utils/selfCheckIn'

// "Ya estoy aquí" is offered from 90 minutes before a visit until it ends,
// while it is still booked and nobody has checked it in.
const appt = { starts_at: '2026-10-12T10:00:00Z', ends_at: '2026-10-12T10:30:00Z', status: 'booked', checked_in_at: null }
const at = (iso: string) => new Date(iso)

describe('canSelfCheckIn', () => {
  it('opens 90 minutes before and closes when the visit ends', () => {
    expect(canSelfCheckIn(appt, at('2026-10-12T08:29:00Z'))).toBe(false)
    expect(canSelfCheckIn(appt, at('2026-10-12T08:30:00Z'))).toBe(true)
    expect(canSelfCheckIn(appt, at('2026-10-12T10:15:00Z'))).toBe(true)
    expect(canSelfCheckIn(appt, at('2026-10-12T10:31:00Z'))).toBe(false)
  })
  it('is not offered twice, nor for a visit that is not booked', () => {
    expect(canSelfCheckIn({ ...appt, checked_in_at: '2026-10-12T09:50:00Z' }, at('2026-10-12T09:55:00Z'))).toBe(false)
    expect(canSelfCheckIn({ ...appt, status: 'cancelled' }, at('2026-10-12T09:55:00Z'))).toBe(false)
  })
})
