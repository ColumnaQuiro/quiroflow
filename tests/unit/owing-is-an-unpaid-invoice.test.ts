import { describe, it, expect } from 'vitest'
import { outstandingCentsOf, type OwingInvoice, type OwingPayment } from '../../utils/owing'

// What the front desk is told a patient owes.
//
// The cases that matter are the ones where the money and the charge sit on
// different patient rows, because that is what the balance cannot see. See
// utils/owing.ts for why the answer is read off invoice status.

const invoice = (over: Partial<OwingInvoice> & { id: string }): OwingInvoice => ({
  status: 'unpaid',
  total_cents: 4400,
  is_refund: false,
  ...over,
})

describe('What a patient owes', () => {
  it('is nothing when every invoice is settled, whoever settled it', () => {
    // Nelson Sandoval: four visits on Henna's family bonos, all marked paid by
    // settle_imported_invoices out of her payments, not one payment row of his
    // own. His balance reads -174,00; he owes nothing.
    const invoices = [
      invoice({ id: 'a', status: 'paid', total_cents: 4300 }),
      invoice({ id: 'b', status: 'paid', total_cents: 4300 }),
      invoice({ id: 'c', status: 'paid' }),
      invoice({ id: 'd', status: 'paid' }),
    ]
    expect(outstandingCentsOf(invoices, [])).toBe(0)
  })

  it('is the unpaid invoice when there is one', () => {
    const invoices = [invoice({ id: 'a', status: 'paid' }), invoice({ id: 'b', total_cents: 5500 })]
    expect(outstandingCentsOf(invoices, [])).toBe(5500)
  })

  it('counts only the part of a part-paid invoice that is still open', () => {
    const invoices = [invoice({ id: 'a', total_cents: 5500 })]
    const payments: OwingPayment[] = [{ invoice_id: 'a', amount_cents: 2000 }]
    expect(outstandingCentsOf(invoices, payments)).toBe(3500)
  })

  it('leaves a voided charge out', () => {
    expect(outstandingCentsOf([invoice({ id: 'a', status: 'void', total_cents: 4300 })], [])).toBe(0)
  })

  it('leaves a refund out rather than letting it cancel real debt', () => {
    // A rectificativa is money going the other way, with a negative total.
    const invoices = [invoice({ id: 'a', total_cents: 5500 }), invoice({ id: 'r', total_cents: -4400, is_refund: true })]
    expect(outstandingCentsOf(invoices, [])).toBe(5500)
  })

  it('is nothing when unallocated money covers the charge', () => {
    // Aurora Cendra, from owing-counts-unallocated-payments.cy.ts: a 50,00
    // invoice still marked unpaid and 50,00 of cash that settles no particular
    // charge. Every imported PracticeHub payment and every bono sale has this
    // shape. The invoices say she owes; the money says she does not.
    const invoices = [invoice({ id: 'a', total_cents: 5000 })]
    const payments: OwingPayment[] = [{ invoice_id: null, amount_cents: 5000 }]
    expect(outstandingCentsOf(invoices, payments)).toBe(0)
  })

  it('owes only what both the invoices and the money agree on', () => {
    // Charged 99,00 across two visits, 55,00 of it still open, and 88,00 has
    // arrived without saying which visit it was for. The money says 11,00 is
    // missing, so 11,00 is what they owe -- not the 55,00 the open invoice
    // shows, and not nothing.
    const invoices = [invoice({ id: 'a', status: 'paid', total_cents: 4400 }), invoice({ id: 'b', total_cents: 5500 })]
    const payments: OwingPayment[] = [{ invoice_id: null, amount_cents: 8800 }]
    expect(outstandingCentsOf(invoices, payments)).toBe(1100)
  })

  it('still reports a charge left unpaid while the patient holds credit', () => {
    // Credit is not in the money term. A patient with account credit beside an
    // unpaid invoice still has an unpaid invoice: applying it is a decision
    // somebody makes, and "Owed now" is where they see that it needs making.
    // The credit shows on its own, as Available.
    const invoices = [invoice({ id: 'a', total_cents: 5500 })]
    expect(outstandingCentsOf(invoices, [])).toBe(5500)
  })

  it('does not let an overpayment on one invoice pay down another', () => {
    // 100,00 landed on a 44,00 invoice. The 56,00 too much is credit on the
    // account, not a discount on the other open visit -- so the open one is
    // owed in full. The third, settled charge is there so the money term is
    // not the binding one and the per-invoice floor is what the answer rests
    // on: without it the overpayment would net off and read 32,00.
    const invoices = [
      invoice({ id: 'a', total_cents: 4400 }),
      invoice({ id: 'b', total_cents: 4400 }),
      invoice({ id: 'c', status: 'paid', total_cents: 8800 }),
    ]
    const payments: OwingPayment[] = [{ invoice_id: 'a', amount_cents: 10000 }]
    expect(outstandingCentsOf(invoices, payments)).toBe(4400)
  })

  it('owes nothing when more money has arrived than has been charged', () => {
    // The same misallocation with nothing else on the account: they have paid
    // 100,00 against 88,00 of charges, so whatever the invoices say about
    // which charge the money belongs to, they are not a debtor.
    const invoices = [invoice({ id: 'a', total_cents: 4400 }), invoice({ id: 'b', total_cents: 4400 })]
    const payments: OwingPayment[] = [{ invoice_id: 'a', amount_cents: 10000 }]
    expect(outstandingCentsOf(invoices, payments)).toBe(0)
  })

  it('still owes the rest of an invoice that credit only part-settled', () => {
    // 22,00 of credit put against a 44,00 charge. The credit payment is not
    // money arriving -- it moves euros counted when they came in -- but it did
    // settle half this charge, so the remainder is what is owed.
    const invoices = [invoice({ id: 'a', total_cents: 4400 })]
    const payments: OwingPayment[] = [
      { invoice_id: null, amount_cents: 2200, method: 'card' },
      { invoice_id: 'a', amount_cents: 2200, method: 'credit' },
    ]
    expect(outstandingCentsOf(invoices, payments)).toBe(2200)
  })

  it('does not let credit spent on a bono cancel an unpaid invoice', () => {
    // Teresa Davis's shape: money on account that never became an
    // account_credits row, then spent on a bono -- which raises no invoice, so
    // the credit payment carries none either. Counting it as money arriving
    // would read her 44,00 charge as settled by a bono she bought instead.
    const invoices = [invoice({ id: 'a', total_cents: 4400 })]
    const payments: OwingPayment[] = [
      { invoice_id: null, amount_cents: 4400, method: 'card' },
      { invoice_id: null, amount_cents: 4400, method: 'credit' },
    ]
    // The card payment alone covers the charge, so nothing is owed either way;
    // what matters is that it is the CARD money doing it.
    expect(outstandingCentsOf(invoices, payments)).toBe(0)
    expect(outstandingCentsOf(invoices, [{ invoice_id: null, amount_cents: 4400, method: 'credit' }])).toBe(4400)
  })
})
