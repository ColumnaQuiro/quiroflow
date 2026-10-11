import { describe, expect, it } from 'vitest'
import { confirmWindowEnd, noShowRisk, noShowRiskByPatient, noShowRiskReason } from '../../utils/noShowRisk'

// The no-show risk rule (utils/noShowRisk.ts): a reason a receptionist can
// say out loud, from the last twelve months of visits that happened.
const now = new Date('2026-10-11T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
const h = (days: number, status: string) => ({ starts_at: daysAgo(days), status })
const t = (en: string) => en

describe('noShowRisk', () => {
  it('reads two misses as high, whatever else they attended', () => {
    const r = noShowRisk([h(10, 'no_show'), h(40, 'no_show'), ...Array.from({ length: 10 }, (_, i) => h(50 + i, 'completed'))], now)
    expect(r).toEqual({ level: 'high', missed: 2, visits: 12 })
    expect(noShowRiskReason(r, t)).toBe('Missed 2 of 12')
  })

  it('reads one miss in three visits as high, and one in many as some', () => {
    expect(noShowRisk([h(5, 'no_show'), h(20, 'completed'), h(30, 'completed')], now).level).toBe('high')
    expect(noShowRisk([h(5, 'no_show'), h(20, 'completed'), h(30, 'completed'), h(40, 'completed')], now).level).toBe('some')
  })

  it('reads someone who has never been in as new, and cancellations as neither', () => {
    expect(noShowRisk([], now).level).toBe('new')
    expect(noShowRisk([h(3, 'cancelled')], now).level).toBe('new')
    expect(noShowRiskReason(noShowRisk([], now), t)).toBe('First visit')
  })

  it('ignores misses older than a year and visits still ahead', () => {
    const r = noShowRisk([h(400, 'no_show'), h(30, 'completed'), { starts_at: '2026-10-12T10:00:00Z', status: 'no_show' }], now)
    expect(r).toEqual({ level: 'none', missed: 0, visits: 1 })
    expect(noShowRiskReason(r, t)).toBe('')
  })

  it('gives every patient asked about a risk, including those with no rows', () => {
    const m = noShowRiskByPatient([{ patient_id: 'a', ...h(3, 'no_show') }, { patient_id: 'a', ...h(9, 'no_show') }], ['a', 'b'], now)
    expect(m.get('a')?.level).toBe('high')
    expect(m.get('b')?.level).toBe('new')
  })
})

describe('confirmWindowEnd', () => {
  it('ends at midnight after tomorrow, on the clinic calendar', () => {
    // 23:30 in Madrid on the 11th is still the 11th there: the list runs to the 13th 00:00.
    expect(confirmWindowEnd(new Date('2026-10-11T21:30:00Z'), 'Europe/Madrid').toISOString()).toBe('2026-10-12T22:00:00.000Z')
    expect(confirmWindowEnd(new Date('2026-10-11T22:30:00Z'), 'Europe/Madrid').toISOString()).toBe('2026-10-13T22:00:00.000Z')
  })
})
