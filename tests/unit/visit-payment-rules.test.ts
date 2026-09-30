import { describe, it, expect } from 'vitest'
import { resolveVisitPayment } from '../../utils/visitPayment'

// Unit-style: no browser, no seeding. Same shape as verifactu-soap.test.ts --
// these are rules about which of four tables answers "how was this visit
// paid for", and they are worth pinning without the cost of a browser.
describe('How a visit was paid', () => {
  it('reads a drawn bono as paid, not as nothing', () => {
    // The case the ledger used to get wrong. A bono visit raises no invoice
    // and takes no payment, so every invoice-shaped check calls it unpaid --
    // while the money changed hands when the pack was bought.
    const result = resolveVisitPayment({
      session: { amount_cents: 4400, external_reference: 'BONO-77' },
      purchase: { package_name: 'Bono 12', sessions_total: 12, sessions_used: 4, external_reference: null },
    })
    expect(result).to.deep.equal({
      kind: 'bono',
      packageName: 'Bono 12',
      remaining: 8,
      total: 12,
      reference: 'BONO-77',
    })
  })

  it('prefers the bono over an invoice that happens to exist', () => {
    // That invoice is the pack's own sale, not a charge for this visit.
    // Naming its number on the row would send someone chasing a payment
    // taken months ago.
    const result = resolveVisitPayment({
      session: { amount_cents: 4400, external_reference: null },
      purchase: { package_name: 'Bono 10', sessions_total: 10, sessions_used: 10, external_reference: 'REF-1' },
      invoice: { invoice_number: 'INV-0009', total_cents: 52800, status: 'paid' },
      payments: [{ method: 'card', amount_cents: 52800 }],
    })
    expect(result.kind).to.equal('bono')
    if (result.kind === 'bono') {
      expect(result.remaining, 'a fully used pack has none left').to.equal(0)
      expect(result.reference, 'falls back to the purchase reference').to.equal('REF-1')
    }
  })

  it('counts what was left after this visit, not what is left today', () => {
    // A finished Bono 12 drawn on 17 and 23 Sep. Read off the pack's counter
    // alone, both rows said "0 of 12 left"; the earlier one had 1 left.
    const purchase = { package_name: 'Bono 12', sessions_total: 12, sessions_used: 12, external_reference: null }
    const earlier = resolveVisitPayment({ session: { amount_cents: 4400, external_reference: null, laterSessions: 1 }, purchase })
    const latest = resolveVisitPayment({ session: { amount_cents: 4400, external_reference: null, laterSessions: 0 }, purchase })
    expect(earlier.kind === 'bono' && earlier.remaining).to.equal(1)
    expect(latest.kind === 'bono' && latest.remaining).to.equal(0)
  })

  it('reads an invoice marked paid as paid, even with no payment attached', () => {
    // PracticeHub history: the invoice is paid, the money came in apart from
    // it. Calling it unpaid listed thousands of settled visits as owed.
    const result = resolveVisitPayment({
      invoice: { invoice_number: 'PHI-7138', total_cents: 4400, status: 'paid' },
      payments: [],
    })
    expect(result).to.deep.equal({ kind: 'settled', methods: [], facturaNumber: null, invoiceNumber: 'PHI-7138' })
  })

  it('names the factura when the settlement produced one', () => {
    const result = resolveVisitPayment({
      invoice: { invoice_number: 'INV-0012', total_cents: 4400, status: 'paid' },
      payments: [{ method: 'card', amount_cents: 4400 }],
      facturaNumbers: ['F2026-0031'],
    })
    expect(result).to.deep.equal({
      kind: 'settled',
      methods: ['card'],
      facturaNumber: 'F2026-0031',
      invoiceNumber: 'INV-0012',
    })
  })

  it('keeps both methods of a split payment', () => {
    // One visit settled two ways. Picking one would misreport the till.
    const result = resolveVisitPayment({
      invoice: { invoice_number: 'INV-0013', total_cents: 5000, status: 'paid' },
      payments: [
        { method: 'cash', amount_cents: 3000 },
        { method: 'card', amount_cents: 2000 },
      ],
    })
    expect(result.kind).to.equal('settled')
    if (result.kind === 'settled') expect(result.methods).to.deep.equal(['cash', 'card'])
  })

  it('does not repeat a method taken twice', () => {
    const result = resolveVisitPayment({
      invoice: { invoice_number: 'INV-0014', total_cents: 5000, status: 'paid' },
      payments: [
        { method: 'cash', amount_cents: 3000 },
        { method: 'cash', amount_cents: 2000 },
      ],
    })
    if (result.kind === 'settled') expect(result.methods).to.deep.equal(['cash'])
  })

  it('calls a charge with no payment unpaid, and carries the amount', () => {
    const result = resolveVisitPayment({
      invoice: { invoice_number: 'INV-0015', total_cents: 6600, status: 'unpaid' },
      payments: [],
    })
    expect(result).to.deep.equal({ kind: 'unpaid', invoiceNumber: 'INV-0015', totalCents: 6600 })
  })

  it('distinguishes a voided charge from an unpaid one', () => {
    // A void is a charge the clinic cancelled. Calling it unpaid puts the
    // visit back on a debtors list it was deliberately taken off.
    const result = resolveVisitPayment({
      invoice: { invoice_number: 'INV-0016', total_cents: 4400, status: 'void' },
      payments: [],
    })
    expect(result).to.deep.equal({ kind: 'void', invoiceNumber: 'INV-0016' })
  })

  it('says nothing rather than guessing when no money is attached', () => {
    // A booked visit in the future, or one the clinic never charged for.
    expect(resolveVisitPayment({})).to.deep.equal({ kind: 'none' })
  })
})
