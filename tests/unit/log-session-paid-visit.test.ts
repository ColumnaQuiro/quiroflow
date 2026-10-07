import { describe, it, expect } from 'vitest'
import { paidVisitToMove } from '../../utils/unloggedVisits'

// Which paid visits Log session may turn into a bono session, moving their
// money onto the bono. See utils/unloggedVisits.ts.

type Receipt = Parameters<typeof paidVisitToMove>[0][number]

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: 'inv',
  invoice_number: 'INV-3672',
  total_cents: 6000,
  status: 'paid',
  is_refund: false,
  invoice_line_items: [{ service_id: null, package_purchase_id: null }],
  payments: [{ amount_cents: 6000, method: 'card' }],
  ...over,
})

const none = new Set<string>()

describe('A paid visit Log session can move onto a bono', () => {
  it('is one paid at the walk-in price, with nothing else on its receipt', () => {
    // 60 EUR by card, before the patient bought the bono.
    expect(paidVisitToMove([receipt()], none)?.id).to.eq('inv')
  })

  it('is not one with an extra sold alongside -- that is still owed in money', () => {
    expect(paidVisitToMove([receipt({ invoice_line_items: [{ service_id: null, package_purchase_id: null }, { service_id: 'pillow', package_purchase_id: null }] })], none)).toBe(null)
  })

  it('is not one a bono already pays for', () => {
    expect(paidVisitToMove([receipt({ invoice_line_items: [{ service_id: null, package_purchase_id: 'bono' }] })], none)).toBe(null)
  })

  it('is not one settled by a write-off, which collected nothing', () => {
    expect(paidVisitToMove([receipt({ payments: [{ amount_cents: 6000, method: 'write_off' }] })], none)).toBe(null)
  })

  it('is not one with no payment behind it -- imported history marked paid', () => {
    expect(paidVisitToMove([receipt({ payments: [] })], none)).toBe(null)
  })

  it('is not one already partly refunded', () => {
    expect(paidVisitToMove([receipt()], new Set(['inv']))).toBe(null)
  })

  it('is not one still unpaid -- Log session already handles that', () => {
    expect(paidVisitToMove([receipt({ status: 'unpaid' })], none)).toBe(null)
  })

  it('is not one with two live receipts, where the money has no single home', () => {
    expect(paidVisitToMove([receipt(), receipt({ id: 'inv-2' })], none)).toBe(null)
  })

  it('ignores a voided receipt beside the paid one', () => {
    expect(paidVisitToMove([receipt(), receipt({ id: 'old', status: 'void' })], none)?.id).to.eq('inv')
  })
})
