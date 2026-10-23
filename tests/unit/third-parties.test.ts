import { describe, expect, it } from 'vitest'
import { agedOutstanding, allocateOldestFirst, chargeOutstandingCents, coverWarnings, eurosToCents } from '../../utils/thirdParties'

const charge = (id: string, amount: number, date: string, paid: number[] = [], status = 'pending') => ({
  id,
  amount_cents: amount,
  status,
  service_date: date,
  allocations: paid.map((amount_cents) => ({ amount_cents })),
})

describe('third parties', () => {
  it('owes what is left on a charge, and nothing on a void one', () => {
    expect(chargeOutstandingCents(charge('a', 3500, '2026-10-01'))).toBe(3500)
    expect(chargeOutstandingCents(charge('a', 3500, '2026-10-01', [2000]))).toBe(1500)
    expect(chargeOutstandingCents(charge('a', 3500, '2026-10-01', [3500]))).toBe(0)
    expect(chargeOutstandingCents(charge('a', 3500, '2026-10-01', [], 'void'))).toBe(0)
  })

  it('ages what is owed by the date of the visit', () => {
    const aged = agedOutstanding(
      [
        charge('a', 1000, '2026-10-20'),
        charge('b', 2000, '2026-09-10'),
        charge('c', 3000, '2026-08-10'),
        charge('d', 4000, '2026-06-01', [1000]),
        charge('e', 9999, '2026-06-01', [], 'void'),
      ],
      '2026-10-22',
    )
    expect(aged).toEqual({ current: 1000, d31_60: 2000, d61_90: 3000, over_90: 3000, total: 9000 })
  })

  it('spreads a payment oldest visit first and stops when it runs out', () => {
    const charges = [charge('new', 3500, '2026-10-15'), charge('old', 3500, '2026-09-01', [500]), charge('mid', 3500, '2026-10-01')]
    const out = allocateOldestFirst(charges, 5000)
    expect([...out.entries()]).toEqual([
      ['old', 3000],
      ['mid', 2000],
    ])
  })

  it('warns, per cover, when the authorised sessions are used or the authorisation has run out', () => {
    expect(coverWarnings({ authorized_sessions: 8, valid_until: null }, 7, '2026-10-22')).toEqual([])
    expect(coverWarnings({ authorized_sessions: 8, valid_until: null }, 8, '2026-10-22')).toEqual([{ kind: 'used_up', used: 8, authorized: 8 }])
    expect(coverWarnings({ authorized_sessions: null, valid_until: '2026-10-21' }, 0, '2026-10-22')).toEqual([{ kind: 'expired', validUntil: '2026-10-21' }])
    expect(coverWarnings({ authorized_sessions: null, valid_until: '2026-10-22' }, 0, '2026-10-22')).toEqual([])
  })

  it('reads euros typed with a comma or a point', () => {
    expect(eurosToCents('35,50')).toBe(3550)
    expect(eurosToCents('10')).toBe(1000)
    expect(eurosToCents('')).toBeNull()
    expect(eurosToCents('abc')).toBeNull()
  })
})
