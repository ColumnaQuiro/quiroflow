import { describe, it, expect } from 'vitest'
import { backdatedPaidAt, isFuturePaymentDate, todayPaymentDate } from '../../utils/paymentDate'

// A payment written down after the day it was taken has to land on that day.

describe('backdatedPaidAt', () => {
  it('leaves today to the database, so the exact moment is kept', () => {
    expect(backdatedPaidAt('2026-11-17', '2026-11-17')).toBeUndefined()
  })

  it('leaves an empty date to the database', () => {
    expect(backdatedPaidAt('', '2026-11-17')).toBeUndefined()
  })

  it('stamps an earlier day at local midday, which stays on that day', () => {
    const iso = backdatedPaidAt('2026-11-03', '2026-11-17')!
    const at = new Date(iso)
    expect(todayPaymentDate(at)).toBe('2026-11-03')
    expect(at.getHours()).toBe(12)
  })

  it('stays on that day across a daylight-saving change', () => {
    const at = new Date(backdatedPaidAt('2026-03-29', '2026-11-17')!) // clocks change that night in Spain
    expect(todayPaymentDate(at)).toBe('2026-03-29')
    expect(at.getHours()).toBe(12)
  })
})

describe('isFuturePaymentDate', () => {
  it('refuses a day that has not happened yet', () => {
    expect(isFuturePaymentDate('2026-11-18', '2026-11-17')).toBe(true)
  })

  it('accepts today, an earlier day, and no date', () => {
    expect(isFuturePaymentDate('2026-11-17', '2026-11-17')).toBe(false)
    expect(isFuturePaymentDate('2025-01-01', '2026-11-17')).toBe(false)
    expect(isFuturePaymentDate('', '2026-11-17')).toBe(false)
  })
})
