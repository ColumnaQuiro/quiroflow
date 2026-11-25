import { describe, it, expect } from 'vitest'
import {
  MONTHS_PER_YEAR,
  billingMethodLabel,
  clinicAllowance,
  dateBlock,
  formatEur,
  formatGb,
  formatLongDate,
  formatShortDate,
  formatWeekdayDate,
  meterPercent,
  nextChargeTotal,
  limitsGrandfathered,
  planLimitsWaived,
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
  // The clinic's own brand in the patient app: its own line, on any plan,
  // counted only when it is bought.
  it('adds the brand add-on to the month and to the annual charge only when it is billed', () => {
    const BRANDING = { monthlyPriceCents: 1500, annualPriceCents: 1300 }
    const monthly = { interval: 'monthly' as const, extraProfessionals: 0, growthBilled: false }
    expect(pricePerMonth(PRACTICE, monthly, GROWTH, null, null, BRANDING)).to.eq(9900)
    expect(pricePerMonth(PRACTICE, { ...monthly, brandingBilled: true }, GROWTH, null, null, BRANDING)).to.eq(11400)
    expect(nextChargeTotal(PRACTICE, { ...monthly, interval: 'annual' as const, brandingBilled: true }, GROWTH, null, null, BRANDING)).to.eq((8900 + 1300) * MONTHS_PER_YEAR)
  })

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

// Clinic since 19 Nov 2026: 2 locations and 6 practitioners included, 29 EUR
// for each further location and 19 EUR for each further practitioner.
describe('Clinic plan caps', () => {
  const CLINIC: PlanPricing = {
    monthlyPriceCents: 14900,
    annualPriceCents: 13400,
    extraProfessionalPriceCents: 1900,
    extraClinicPriceCents: 2900,
  }
  const CLINIC_PLAN = { included_clinics: 2, extra_clinic_price_cents: 2900 }
  const PRACTICE_PLAN = { included_clinics: 1, extra_clinic_price_cents: null }

  it('charges each bought location, at the same rate on both intervals', () => {
    // Three sites and nine practitioners: 149 + 1 x 29 + 3 x 19 = 235.
    const monthly = { interval: 'monthly' as const, extraProfessionals: 3, extraClinics: 1, growthBilled: false }
    expect(pricePerMonth(CLINIC, monthly, GROWTH)).to.eq(23500)
    // Annual discounts the plan only: 134 + 29 + 57 = 220 a month, twelve at once.
    const annual = { ...monthly, interval: 'annual' as const }
    expect(pricePerMonth(CLINIC, annual, GROWTH)).to.eq(22000)
    expect(nextChargeTotal(CLINIC, annual, GROWTH)).to.eq(22000 * MONTHS_PER_YEAR)
  })

  it('charges nothing for locations on a plan with no price for one', () => {
    const stale = { interval: 'monthly' as const, extraProfessionals: 0, extraClinics: 2, growthBilled: false }
    expect(pricePerMonth(PRACTICE, stale, GROWTH)).to.eq(9900)
  })

  it('adds bought locations to the two the plan includes', () => {
    expect(clinicAllowance(CLINIC_PLAN, 0, false)).to.eq(2)
    expect(clinicAllowance(CLINIC_PLAN, 3, false)).to.eq(5)
  })

  it('does not credit bought locations on a plan that does not sell them', () => {
    // The row a clinic has just after leaving Clinic, before the webhook clears it.
    expect(clinicAllowance(PRACTICE_PLAN, 2, false)).to.eq(1)
  })

  it('reports no ceiling for a comped account, an open trial, or a plan with none', () => {
    expect(clinicAllowance(CLINIC_PLAN, 0, true), 'limits waived').to.eq(null)
    expect(clinicAllowance({ included_clinics: null, extra_clinic_price_cents: null }, 0, false), 'no cap on the plan').to.eq(null)
    expect(clinicAllowance(null, 0, false), 'no plan read yet').to.eq(null)
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

  it('writes dates in English for someone reading in English, amounts unchanged', () => {
    // Amounts stay Spanish -- the money is in Spain -- but a date is words, and
    // "Patient since 16 de junio de 2025" in the English UI read as unfinished.
    expect(formatLongDate('2026-10-21T00:00:00.000Z', 'en')).to.eq('21 October 2026')
    expect(formatShortDate('2026-09-13T12:00:00.000Z', 'en')).to.eq('13 Sept')
    expect(formatWeekdayDate('2026-09-23T12:00:00.000Z', 'en')).to.eq('Wed 23 Sept')
    expect(dateBlock('2026-10-05T12:00:00.000Z', 'en')).to.deep.eq({ day: '5', month: 'Oct' })
    expect(formatShortDate('2026-09-13T12:00:00.000Z')).to.eq('13 sept')
  })

  it('formats storage with a decimal that suits the size', () => {
    // Two decimals below 10 GB, one above -- a clinic with 400 MB wants to
    // see 0,39 GB, not 0,4 GB.
    expect(formatGb(0.39)).to.eq('0,39 GB')
    expect(formatGb(19.8)).to.eq('19,8 GB')
    expect(formatGb(104.25)).to.eq('104,3 GB')
  })

  it('labels the payment method without inventing a card number', () => {
    expect(billingMethodLabel({ brand: 'visa', last4: '4242' })).to.eq('visa ·· 4242')
    // Stripe Link carries no card details: a clinic paying with it must not
    // read "Link ·· null" or, worse, "No card on file".
    expect(billingMethodLabel({ brand: 'Link', last4: null })).to.eq('Link')
  })

  it('caps the meter at full and reports none when there is no allowance', () => {
    expect(meterPercent(20, 100)).to.eq(20)
    expect(meterPercent(140, 100), 'over the allowance still reads as full').to.eq(100)
    expect(meterPercent(20, null), 'no allowance, no meter').to.eq(null)
  })
})

describe('Plan limits during the free trial', () => {
  // The same rule as practitioner_seat_allowance() and
  // clinic_location_allowance() in 20260924100032. The usage card prints a
  // limit only where the database enforces one.
  it('waives them for a trial nobody has put a card on yet', () => {
    expect(planLimitsWaived({ status: 'trialing', comped: false, stripe_subscription_id: null })).to.eq(true)
  })

  it('applies them once the trial carries a Stripe subscription, or has ended', () => {
    expect(planLimitsWaived({ status: 'trialing', comped: false, stripe_subscription_id: 'sub_1' })).to.eq(false)
    expect(planLimitsWaived({ status: 'active', comped: false, stripe_subscription_id: 'sub_1' })).to.eq(false)
    expect(planLimitsWaived({ status: 'locked', comped: false, stripe_subscription_id: null })).to.eq(false)
  })

  it('waives them for a comped account whatever its status says', () => {
    expect(planLimitsWaived({ status: 'active', comped: true, stripe_subscription_id: null })).to.eq(true)
  })

  it('waives them on the plan an account was grandfathered on, and only there', () => {
    // subscriptions.limits_waived_on_plan (20261125062215): Clinic as it was before 19 Nov.
    const paying = { status: 'active', comped: false, stripe_subscription_id: 'sub_1', limits_waived_on_plan: 'clinic' }
    expect(planLimitsWaived({ ...paying, plan_id: 'clinic' }), 'on Clinic').to.eq(true)
    expect(planLimitsWaived({ ...paying, plan_id: 'starter' }), 'moved to Solo').to.eq(false)
    expect(limitsGrandfathered({ plan_id: 'clinic', limits_waived_on_plan: 'clinic' })).to.eq(true)
    expect(limitsGrandfathered({ plan_id: 'clinic', limits_waived_on_plan: null }), 'no waiver').to.eq(false)
    expect(limitsGrandfathered({ plan_id: undefined, limits_waived_on_plan: undefined }), 'nothing read yet').to.eq(false)
  })
})
