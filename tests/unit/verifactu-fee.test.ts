import { describe, it, expect } from 'vitest'
import { findVerifactuFeeItem, verifactuFeeItemChange } from '../../utils/verifactuFee'
import { nextChargeTotal, pricePerMonth } from '../../utils/billing'

// The VeriFactu fee: 7,50 EUR a month per location, from the live date.
describe('The VeriFactu fee’s line on the subscription', () => {
  const MONTHLY = 'price_verifactu_month'
  const ANNUAL = 'price_verifactu_year'
  const prices = new Set([MONTHLY, ANNUAL])

  it('is added when a clinic goes live, one unit per location', () => {
    expect(verifactuFeeItemChange(null, MONTHLY, 2)).to.deep.eq({ price: MONTHLY, quantity: 2 })
  })

  it('is left alone when it already says what is due', () => {
    expect(verifactuFeeItemChange({ id: 'si_1', priceId: MONTHLY, quantity: 2 }, MONTHLY, 2)).to.eq(null)
  })

  it('follows the number of locations', () => {
    expect(verifactuFeeItemChange({ id: 'si_1', priceId: MONTHLY, quantity: 2 }, MONTHLY, 3)).to.deep.eq({ id: 'si_1', price: MONTHLY, quantity: 3 })
  })

  it('moves to the annual price with the plan, or Stripe refuses the mixed intervals', () => {
    expect(verifactuFeeItemChange({ id: 'si_1', priceId: MONTHLY, quantity: 2 }, ANNUAL, 2)).to.deep.eq({ id: 'si_1', price: ANNUAL, quantity: 2 })
  })

  it('is removed when nothing is due any more', () => {
    expect(verifactuFeeItemChange({ id: 'si_1', priceId: MONTHLY, quantity: 1 }, MONTHLY, 0)).to.deep.eq({ id: 'si_1', deleted: true })
    expect(verifactuFeeItemChange(null, MONTHLY, 0)).to.eq(null)
  })

  it('never blocks a change when no price is configured', () => {
    expect(verifactuFeeItemChange(null, null, 2)).to.eq(null)
  })

  it('is found among the subscription’s items by either of its prices', () => {
    const items = [
      { id: 'si_plan', priceId: 'price_plan', quantity: 1 },
      { id: 'si_fee', priceId: ANNUAL, quantity: 3 },
    ]
    expect(findVerifactuFeeItem(items, prices)?.id).to.eq('si_fee')
    expect(findVerifactuFeeItem(items.slice(0, 1), prices)).to.eq(null)
  })
})

describe('The local estimate of what a subscription costs', () => {
  const plan = { monthlyPriceCents: 4900, annualPriceCents: 4400, extraProfessionalPriceCents: 1900 }
  const fee = { monthlyPriceCents: 750, annualPriceCents: 750 }

  it('adds the VeriFactu fee per billed location', () => {
    const shape = { interval: 'monthly' as const, extraProfessionals: 0, growthBilled: false, verifactuLocations: 2 }
    expect(pricePerMonth(plan, shape, null, fee)).to.eq(4900 + 1500)
  })

  it('bills it twelve months at a time on an annual plan, with no discount', () => {
    const shape = { interval: 'annual' as const, extraProfessionals: 0, growthBilled: false, verifactuLocations: 1 }
    expect(nextChargeTotal(plan, shape, null, fee)).to.eq((4400 + 750) * 12)
  })

  it('is unchanged for a clinic that is not live', () => {
    const shape = { interval: 'monthly' as const, extraProfessionals: 0, growthBilled: false }
    expect(pricePerMonth(plan, shape, null, fee)).to.eq(4900)
  })
})
