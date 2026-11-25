import { describe, expect, it } from 'vitest'
import {
  goCardlessSubscriptionMembershipStatus,
  membershipIntervalOfGoCardless,
  suggestPlanForSubscription,
  type ImportablePlan,
} from '../../utils/gocardlessSubscriptionImport'

// Another app's GoCardless subscriptions synced as memberships: which ones
// can be, what cadence they become, and which plan the screen preselects.
// The plans are invented.

const plans: ImportablePlan[] = [
  { id: 'mensual', name: 'Mantenimiento mensual', price_cents: 4500, billing_interval: 'month', billing_interval_count: 1 },
  { id: 'familiar', name: 'Plan Familiar', price_cents: 7000, billing_interval: 'month', billing_interval_count: 1 },
  { id: 'anual', name: 'Anual', price_cents: 45000, billing_interval: 'year', billing_interval_count: 1 },
  { id: 'trimestral', name: 'Trimestral', price_cents: 12000, billing_interval: 'month', billing_interval_count: 3 },
]

describe('membershipIntervalOfGoCardless', () => {
  it('speaks the membership vocabulary', () => {
    expect(membershipIntervalOfGoCardless('monthly', 1)).toEqual({ interval: 'month', count: 1 })
    expect(membershipIntervalOfGoCardless('weekly', 2)).toEqual({ interval: 'week', count: 2 })
    expect(membershipIntervalOfGoCardless('yearly', 1)).toEqual({ interval: 'year', count: 1 })
  })

  it('keeps the count within what a membership holds', () => {
    expect(membershipIntervalOfGoCardless('monthly', 0)).toEqual({ interval: 'month', count: 1 })
    expect(membershipIntervalOfGoCardless('monthly', null)).toEqual({ interval: 'month', count: 1 })
    expect(membershipIntervalOfGoCardless('monthly', 24)).toEqual({ interval: 'month', count: 12 })
  })
})

describe('goCardlessSubscriptionMembershipStatus', () => {
  it('brings in only a subscription that is collecting, or paused', () => {
    expect(goCardlessSubscriptionMembershipStatus('active')).toBe('active')
    expect(goCardlessSubscriptionMembershipStatus('paused')).toBe('paused')
    for (const status of ['pending_customer_approval', 'customer_approval_denied', 'cancelled', 'finished']) {
      expect(goCardlessSubscriptionMembershipStatus(status), status).toBeNull()
    }
  })
})

describe('suggestPlanForSubscription', () => {
  const sub = (over: Partial<{ name: string | null; amountCents: number; intervalUnit: string; interval: number }> = {}) => ({
    name: null,
    amountCents: 4500,
    intervalUnit: 'monthly',
    interval: 1,
    ...over,
  })

  it('takes the plan with the same name, whatever the accents, case and price', () => {
    expect(suggestPlanForSubscription(sub({ name: 'PLAN FAMILIAR', amountCents: 6500 }), plans)).toEqual({ planId: 'familiar', by: 'name' })
    expect(suggestPlanForSubscription(sub({ name: 'Mantenimiento  Mensual.' }), plans)).toEqual({ planId: 'mensual', by: 'name' })
  })

  it('falls back to the one plan with the same price and cadence', () => {
    expect(suggestPlanForSubscription(sub({ name: 'Membresía PracticeHub' }), plans)).toEqual({ planId: 'mensual', by: 'price' })
    expect(suggestPlanForSubscription(sub({ amountCents: 12000, interval: 3 }), plans)).toEqual({ planId: 'trimestral', by: 'price' })
    expect(suggestPlanForSubscription(sub({ amountCents: 45000, intervalUnit: 'yearly' }), plans)).toEqual({ planId: 'anual', by: 'price' })
  })

  it('does not take a plan of the same price on another cadence', () => {
    expect(suggestPlanForSubscription(sub({ amountCents: 12000, interval: 1 }), plans)).toBeNull()
  })

  it('suggests nothing when two plans fit equally well', () => {
    const twins = [...plans, { id: 'otro', name: 'Mensual antiguo', price_cents: 4500, billing_interval: 'month', billing_interval_count: 1 }]
    expect(suggestPlanForSubscription(sub(), twins)).toBeNull()
    const sameName = [...plans, { ...plans[1]!, id: 'familiar-2' }]
    // Two plans of that name: neither by name, and the price (7000) fits both too.
    expect(suggestPlanForSubscription(sub({ name: 'Plan familiar', amountCents: 7000 }), sameName)).toBeNull()
  })

  it('suggests nothing with no plans', () => {
    expect(suggestPlanForSubscription(sub(), [])).toBeNull()
  })
})
