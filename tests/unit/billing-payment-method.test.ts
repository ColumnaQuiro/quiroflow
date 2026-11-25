import { describe, it, expect } from 'vitest'
import type Stripe from 'stripe'
import { describeBillingPaymentMethod } from '../../server/utils/billingPaymentMethod'

const pm = (fields: Partial<Stripe.PaymentMethod>) => ({ id: 'pm_x', object: 'payment_method', ...fields }) as Stripe.PaymentMethod

describe('describeBillingPaymentMethod', () => {
  it('reads a card', () => {
    expect(describeBillingPaymentMethod(pm({ type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 9, exp_year: 2028 } as Stripe.PaymentMethod.Card }))).to.deep.eq({
      brand: 'visa',
      last4: '4242',
      expMonth: 9,
      expYear: 2028,
    })
  })

  it('reads Stripe Link, which has no card details', () => {
    // How a clinic that paid through Checkout with Link looked: a real,
    // chargeable method that the card-only lookup reported as "No card on file".
    expect(describeBillingPaymentMethod(pm({ type: 'link' }))).to.deep.eq({ brand: 'Link', last4: null, expMonth: null, expYear: null })
  })

  it('reads a SEPA mandate by its last four', () => {
    expect(describeBillingPaymentMethod(pm({ type: 'sepa_debit', sepa_debit: { last4: '3000' } as Stripe.PaymentMethod.SepaDebit }))?.last4).to.eq('3000')
  })

  it('returns null for an unexpanded id or nothing', () => {
    expect(describeBillingPaymentMethod('pm_123')).to.eq(null)
    expect(describeBillingPaymentMethod(null)).to.eq(null)
  })
})
