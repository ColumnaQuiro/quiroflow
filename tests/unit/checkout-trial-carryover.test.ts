import { describe, it, expect } from 'vitest'
import { CHECKOUT_MIN_TRIAL_SECONDS, annualSavingPercent, checkoutTrialEnd } from '../../utils/billing'

// When a clinic adds its card, Stripe Checkout is told when to charge first.
//
// It used to be told nothing, so Stripe charged on the spot: a clinic adding a
// card on day 3 of a 30-day trial paid that day and lost the other 27, while
// /subscription was telling it "add a card before then and nothing is
// interrupted". checkoutTrialEnd is the rule subscribe.post.ts now builds the
// Checkout Session with, and the page uses the same one to say whether the
// clinic has just paid or just saved a card.

const NOW = new Date('2026-09-23T12:00:00Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

describe('Carrying the trial into Checkout', () => {
  it('keeps the rest of the trial, to the second, for a clinic that is still in it', () => {
    const endsAt = days(27)
    expect(checkoutTrialEnd({ status: 'trialing', trial_ends_at: endsAt, comped: false }, NOW)).toBe(unix(endsAt))
  })

  it('charges now once there is no trial left to keep', () => {
    expect(checkoutTrialEnd({ status: 'locked', trial_ends_at: days(-2), comped: false }, NOW)).toBeNull()
    expect(checkoutTrialEnd({ status: 'canceled', trial_ends_at: null, comped: false }, NOW)).toBeNull()
    expect(checkoutTrialEnd({ status: 'trialing', trial_ends_at: days(-1), comped: false }, NOW)).toBeNull()
    expect(checkoutTrialEnd({ status: 'trialing', trial_ends_at: null, comped: false }, NOW)).toBeNull()
    expect(checkoutTrialEnd(null, NOW)).toBeNull()
  })

  // Stripe refuses a Checkout trial_end under 48 hours away, so the last two
  // days of a trial start billing at once rather than failing the checkout.
  it('stays clear of the 48-hour floor Stripe enforces', () => {
    expect(CHECKOUT_MIN_TRIAL_SECONDS).toBeGreaterThan(48 * 3600)
    expect(checkoutTrialEnd({ status: 'trialing', trial_ends_at: days(2), comped: false }, NOW)).toBeNull()
    expect(checkoutTrialEnd({ status: 'trialing', trial_ends_at: days(3), comped: false }, NOW)).toBe(unix(days(3)))
  })

  // A comped account carries status 'trialing' with no real trial behind it.
  it('never invents a trial for a comped account', () => {
    expect(checkoutTrialEnd({ status: 'trialing', trial_ends_at: days(20), comped: true }, NOW)).toBeNull()
  })
})

describe('Annual saving, as quoted on the Growth card', () => {
  it('is worked out from the prices rather than stated', () => {
    // Growth after the 17 Sep reprice: 39 monthly, 35 a month on annual. The
    // card said "save 20%" -- true of the 49/39 it was written against.
    expect(annualSavingPercent({ monthlyPriceCents: 3900, annualPriceCents: 3500 })).toBe(10)
    expect(annualSavingPercent({ monthlyPriceCents: 4900, annualPriceCents: 3900 })).toBe(20)
    expect(annualSavingPercent({ monthlyPriceCents: 0, annualPriceCents: 0 })).toBe(0)
  })
})
