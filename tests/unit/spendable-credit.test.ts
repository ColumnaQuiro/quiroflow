import { describe, it, expect } from 'vitest'
import { ledgerDrawCents, spendableCreditOf } from '../../utils/owing'

// What a charge screen may offer as "credit on account", and how much of a
// credit spend comes off the ledger -- see utils/owing.ts.

describe('Spendable credit', () => {
  it('offers money paid ahead in PracticeHub, which has no credit ledger row', () => {
    // 50 paid, nothing charged yet, no account_credits row.
    expect(spendableCreditOf({ creditLedgerCents: 0, balanceCents: 5000, outstandingCents: 0, bonoValueCents: 0 })).toBe(5000)
  })

  it('still offers it once the visit it was paid for has been invoiced', () => {
    // 50 paid, 50 visit invoiced and unpaid: the balance reads 0, but paying
    // that invoice is exactly what the 50 is for.
    expect(spendableCreditOf({ creditLedgerCents: 0, balanceCents: 0, outstandingCents: 5000, bonoValueCents: 0 })).toBe(5000)
  })

  it('offers nothing once it has been spent on that visit', () => {
    expect(spendableCreditOf({ creditLedgerCents: 0, balanceCents: 0, outstandingCents: 0, bonoValueCents: 0 })).toBe(0)
  })

  it('does not offer prepaid bono money: that buys the sessions', () => {
    // 264 paid for a bono with every session left.
    expect(spendableCreditOf({ creditLedgerCents: 0, balanceCents: 26400, outstandingCents: 0, bonoValueCents: 26400 })).toBe(0)
  })

  it('offers the whole ledger even when the patient owes on an invoice', () => {
    // 100 of goodwill credit and an unpaid 55: balance 45, 100 to spend.
    expect(spendableCreditOf({ creditLedgerCents: 10000, balanceCents: 4500, outstandingCents: 5500, bonoValueCents: 0 })).toBe(10000)
  })

  it('counts ledger credit once, not again as money paid ahead', () => {
    // "Add credit" 50: a payment plus a ledger row; the balance reads 50.
    expect(spendableCreditOf({ creditLedgerCents: 5000, balanceCents: 5000, outstandingCents: 0, bonoValueCents: 0 })).toBe(5000)
  })

  it('offers nothing to a patient who simply owes money', () => {
    expect(spendableCreditOf({ creditLedgerCents: 0, balanceCents: -4400, outstandingCents: 4400, bonoValueCents: 0 })).toBe(0)
  })
})

describe('Drawing a credit spend from the ledger', () => {
  it('writes no ledger row for money paid ahead', () => {
    expect(ledgerDrawCents(5000, 0)).toBe(0)
  })

  it('draws the whole spend from a ledger that covers it', () => {
    expect(ledgerDrawCents(5000, 8000)).toBe(5000)
  })

  it('draws only what the ledger holds and leaves the rest to money paid ahead', () => {
    expect(ledgerDrawCents(5000, 2000)).toBe(2000)
  })

  it('never draws from a ledger that is already negative', () => {
    expect(ledgerDrawCents(5000, -2400)).toBe(0)
  })
})
