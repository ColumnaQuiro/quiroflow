import { describe, it, expect } from 'vitest'
import {
  MONTHS_PER_YEAR,
  formatEur,
  formatGb,
  formatLongDate,
  meterPercent,
  nextChargeTotal,
  pricePerMonth,
  seatAllowance,
  subscriptionState,
  type PlanPricing,
} from '../../utils/billing'

// The arithmetic and the state map behind /subscription.
//
// No browser here -- these are pure functions, the same pattern
// verifactu-soap.test.ts uses. They run under Vitest in `npm run preflight`,
// so the rules are checked on every PR without a Cypress shard paying for it.

const PRACTICE: PlanPricing = {
  monthlyPriceCents: 9900,
  annualPriceCents: 8900,
  extraProfessionalPriceCents: 1900,
}
const GROWTH = { monthlyPriceCents: 3900, annualPriceCents: 3500 }

describe('Subscription pricing rules', () => {
  // The bug this exists to prevent: an annual customer was shown 44,00 € as
  // their next payment while Stripe took 528,00 €, because one helper
  // produced both numbers. They must never be equal on an annual plan.
  it('never reports the per-month figure as the next charge on an annual plan', () => {
    const annual = { interval: 'annual' as const, extraProfessionals: 0, growthBilled: false }

    const perMonth = pricePerMonth(PRACTICE, annual, GROWTH)
    const charge = nextChargeTotal(PRACTICE, annual, GROWTH)

    expect(perMonth, 'per-month figure').to.eq(8900)
    expect(charge, 'the one annual charge').to.eq(8900 * MONTHS_PER_YEAR)
    expect(charge, 'annual charge must not equal the monthly figure').to.not.eq(perMonth)
    // Intl puts a NON-BREAKING space before the euro sign, and Spanish does
    // not group a four-digit number -- CLDR sets minimumGroupingDigits to 2
    // for es, and the RAE agrees. So this is "1068,00 €", not the "1.068,00 €"
    // the artboards draw by hand. Grouping starts at five digits.
    expect(formatEur(charge)).to.eq('1068,00\u00a0€')
    expect(formatEur(1_060_000)).to.eq('10.600,00\u00a0€')
  })

  it('makes the two numbers equal only on a monthly plan', () => {
    const monthly = { interval: 'monthly' as const, extraProfessionals: 0, growthBilled: false }
    expect(nextChargeTotal(PRACTICE, monthly, GROWTH)).to.eq(pricePerMonth(PRACTICE, monthly, GROWTH))
  })

  it('counts extra seats and the add-on into both figures, at the matching cadence', () => {
    const annual = { interval: 'annual' as const, extraProfessionals: 1, growthBilled: true }
    // 89,00 plan + 19,00 seat + 35,00 add-on (annual rates) = 143,00 a month.
    expect(pricePerMonth(PRACTICE, annual, GROWTH)).to.eq(14300)
    expect(nextChargeTotal(PRACTICE, annual, GROWTH)).to.eq(14300 * MONTHS_PER_YEAR)

    const monthly = { interval: 'monthly' as const, extraProfessionals: 1, growthBilled: true }
    // Monthly rates are the higher ones: 99,00 + 19,00 + 39,00.
    expect(pricePerMonth(PRACTICE, monthly, GROWTH)).to.eq(15700)
  })

  it('charges nothing for the add-on when it is not billed as its own line', () => {
    // A plan that bundles Growth has no Stripe line item for it, so quoting
    // one would overstate the invoice.
    const bundled = { interval: 'monthly' as const, extraProfessionals: 0, growthBilled: false }
    expect(pricePerMonth(PRACTICE, bundled, GROWTH)).to.eq(9900)
  })
})

describe('Subscription state map', () => {
  it('maps every status to itself, and comped over all of them', () => {
    expect(subscriptionState('trialing', false)).to.eq('trialing')
    expect(subscriptionState('active', false)).to.eq('active')
    expect(subscriptionState('past_due', false)).to.eq('past_due')
    expect(subscriptionState('locked', false)).to.eq('locked')
    expect(subscriptionState('canceled', false)).to.eq('canceled')
  })

  it('lets comped win over the row status', () => {
    // A complimentary account carries 'trialing' forever; telling its owner
    // the trial is ending would be a lie the page used to tell.
    expect(subscriptionState('trialing', true)).to.eq('comped')
    expect(subscriptionState('active', true)).to.eq('comped')
    expect(subscriptionState('past_due', true)).to.eq('comped')
  })

  it('treats an unrecognised status as locked rather than healthy', () => {
    expect(subscriptionState('something_new_from_stripe', false)).to.eq('locked')
  })
})

describe('Seat allowance', () => {
  it('adds bought seats to the plan allowance', () => {
    expect(seatAllowance(4, 1, false)).to.eq(5)
  })

  it('reports no ceiling for an unlimited plan or a comped account', () => {
    expect(seatAllowance(null, 0, false), 'unlimited plan').to.eq(null)
    expect(seatAllowance(4, 1, true), 'comped account').to.eq(null)
  })
})

describe('es-ES formatting', () => {
  it('formats money and dates in the same locale', () => {
    expect(formatEur(166_98)).to.eq('166,98\u00a0€')
    expect(formatEur(1_068_00)).to.eq('1068,00\u00a0€')
    // The page used to render this date as "October 21, 2026" beside those
    // amounts, in one sentence.
    expect(formatLongDate('2026-10-21T00:00:00.000Z')).to.eq('21 de octubre de 2026')
  })

  it('formats storage with a decimal that suits the size', () => {
    // Two decimals below 10 GB, one above -- a clinic with 400 MB wants to
    // see 0,39 GB, not 0,4 GB.
    expect(formatGb(0.39)).to.eq('0,39 GB')
    expect(formatGb(19.8)).to.eq('19,8 GB')
    expect(formatGb(104.25)).to.eq('104,3 GB')
  })

  it('caps the meter at full and reports none when there is no allowance', () => {
    expect(meterPercent(20, 100)).to.eq(20)
    expect(meterPercent(140, 100), 'over the allowance still reads as full').to.eq(100)
    expect(meterPercent(20, null), 'no allowance, no meter').to.eq(null)
  })
})
