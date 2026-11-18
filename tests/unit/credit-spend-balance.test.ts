import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { balanceCreditCentsOf, creditRowCountsInBalance, ledgerDrawCents, spendableCreditOf, type BalanceCreditRow } from '../../utils/owing'

// The balance is money in - charged + credit granted without a payment, and
// spending credit moves nothing -- see utils/owing balanceCreditCentsOf and
// 20261118100728_credit_spend_moves_no_money.sql, which patient_live_balances
// follows term for term.

interface Payment { amount_cents: number; method: string }
type Credit = BalanceCreditRow

/** The balance as usePatientFinancialSummary and the view compute it. */
function balanceOf(payments: Payment[], chargedCents: number, credits: Credit[]): number {
  const money = payments.filter((p) => p.method !== 'credit').reduce((s, p) => s + p.amount_cents, 0)
  return money - chargedCents + balanceCreditCentsOf(credits)
}

/** The credit ledger: every row but the cutover entries, spends included. */
function ledgerOf(credits: Credit[]): number {
  return credits.filter((c) => !c.external_reference?.startsWith('bono-cutover-')).reduce((s, c) => s + c.amount_cents, 0)
}

describe('The balance when credit is spent', () => {
  it('reads zero after credit added on account pays a visit of the same size', () => {
    // "Add credit" 50 in card, then a 50 visit paid from it.
    const payments = [{ amount_cents: 5000, method: 'card' }, { amount_cents: 5000, method: 'credit' }]
    const credits: Credit[] = [
      { amount_cents: 5000, payment_id: 'top-up' },
      { amount_cents: -5000, is_spend: true },
    ]
    expect(balanceOf(payments, 5000, credits)).toBe(0)
    expect(ledgerOf(credits)).toBe(0)
  })

  it('reads zero after goodwill credit pays a visit of the same size', () => {
    // 20 granted with no payment, a 20 visit paid from it.
    const credits: Credit[] = [{ amount_cents: 2000 }, { amount_cents: -2000, is_spend: true }]
    expect(balanceOf([{ amount_cents: 2000, method: 'credit' }], 2000, credits)).toBe(0)
  })

  it('reads what is left when only part of the credit is spent', () => {
    // 100 goodwill, a 45 visit paid from it: 55 left, counted once.
    const credits: Credit[] = [{ amount_cents: 10000 }, { amount_cents: -4500, is_spend: true }]
    expect(balanceOf([{ amount_cents: 4500, method: 'credit' }], 4500, credits)).toBe(5500)
    expect(ledgerOf(credits)).toBe(5500)
  })

  it('agrees with the patient who read -165 having paid exactly what they were charged', () => {
    // 360 in card, 360 charged; 165 of it put on account and spent on three
    // visits -- two of whose receipts were later replaced by the same visits
    // imported from PracticeHub, taking their credit payments with them. The
    // spend rows stay, and stay spends.
    const payments = [
      { amount_cents: 7000, method: 'card' },
      { amount_cents: 7000, method: 'card' },
      { amount_cents: 11000, method: 'card' },
      { amount_cents: 5500, method: 'card' },
      { amount_cents: 5500, method: 'card' },
      { amount_cents: 5500, method: 'credit' },
    ]
    const credits: Credit[] = [
      { amount_cents: 11000, payment_id: 'p1' },
      { amount_cents: -5500, is_spend: true },
      { amount_cents: -5500, is_spend: true },
      { amount_cents: 5500, payment_id: 'p2' },
      { amount_cents: -5500, is_spend: true },
    ]
    expect(balanceOf(payments, 36000, credits)).toBe(0)
    // What it read before: the spend rows were counted.
    expect(balanceOf(payments, 36000, credits.map((c) => ({ ...c, is_spend: false })))).toBe(-16500)
    // Nothing left to spend: the ledger is empty and nothing was paid ahead.
    expect(spendableCreditOf({ creditLedgerCents: ledgerOf(credits), balanceCents: 0, outstandingCents: 0, bonoValueCents: 0 })).toBe(0)
  })

  it('takes credit transferred to another patient off this one and puts it on theirs', () => {
    // A transfer is not a spend: no credit payment, and the credit really moved.
    const giver: Credit[] = [{ amount_cents: 3000 }, { amount_cents: -3000 }]
    const taker: Credit[] = [{ amount_cents: 3000 }]
    expect(balanceCreditCentsOf(giver)).toBe(0)
    expect(balanceCreditCentsOf(taker)).toBe(3000)
  })

  it('splits a spend between the ledger and money paid ahead, and the balance agrees', () => {
    // 20 goodwill plus 30 paid ahead, a 45 visit paid wholly from credit:
    // 20 comes off the ledger, 25 off the money paid ahead (no row).
    const draw = ledgerDrawCents(4500, 2000)
    expect(draw).toBe(2000)
    const credits: Credit[] = [{ amount_cents: 2000 }, { amount_cents: -draw, is_spend: true }]
    const payments = [{ amount_cents: 3000, method: 'cash' }, { amount_cents: 4500, method: 'credit' }]
    expect(balanceOf(payments, 4500, credits)).toBe(500)
    expect(ledgerOf(credits)).toBe(0)
    expect(spendableCreditOf({ creditLedgerCents: 0, balanceCents: 500, outstandingCents: 0, bonoValueCents: 0 })).toBe(500)
  })
})

describe('Which credit rows count in the balance', () => {
  it('counts credit granted without a payment', () => {
    expect(creditRowCountsInBalance({ amount_cents: 2000 })).toBe(true)
  })

  it('does not count a row restating a payment', () => {
    expect(creditRowCountsInBalance({ amount_cents: 5000, payment_id: 'p' })).toBe(false)
  })

  it('does not count a spend', () => {
    expect(creditRowCountsInBalance({ amount_cents: -5000, is_spend: true })).toBe(false)
  })

  it('counts a negative adjustment that is not a spend', () => {
    expect(creditRowCountsInBalance({ amount_cents: -4400, external_reference: 'PH-package-490-adjustment' })).toBe(true)
  })

  it('counts the PracticeHub cutover entries whatever they carry', () => {
    expect(creditRowCountsInBalance({ amount_cents: -17600, external_reference: 'bono-cutover-12', payment_id: 'p' })).toBe(true)
  })
})

describe('Every screen that spends credit marks the row as a spend', () => {
  // A spend row written without is_spend is counted in the balance again --
  // the bug the flag fixes, one forgotten line away from coming back.
  const files = ['components/patients/BillingTab.vue', 'composables/useVisitCharging.ts', 'pages/billing/[id].vue']
  for (const file of files) {
    it(file, () => {
      const source = readFileSync(resolve(__dirname, '../..', file), 'utf8')
      const spends = source.split('amount_cents: -fromLedgerCents,').slice(1)
      expect(spends.length, 'it still writes spend rows').toBeGreaterThan(0)
      for (const after of spends) expect(after.slice(0, 200)).toContain('is_spend: true')
    })
  }
})
