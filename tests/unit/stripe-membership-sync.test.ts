import { describe, expect, it } from 'vitest'
import { suggestMandatePatient, type MatchablePatient } from '../../utils/gocardlessMatch'
import {
  closestSameCharge,
  couldBeSameCharge,
  membershipIntervalOf,
  pairWithBookedCharges,
  stripeAutoPairDecision,
  stripeCustomerAsMatchable,
  stripeSubscriptionState,
} from '../../utils/stripeMembershipSync'

// Stripe subscriptions brought in as memberships: what a webhook decides on
// its own, what Stripe's states become, and how one charge arriving by two
// roads is counted once. The people are invented.

const patients: MatchablePatient[] = [
  { id: 'ana', first_name: 'Ana', last_name: 'García Pérez', email: 'ana@example.com', phone_search: '612345678' },
  { id: 'luis', first_name: 'Luis', last_name: 'Martín', email: 'familia@example.com', phone_search: '699000111' },
  { id: 'sofia', first_name: 'Sofía', last_name: 'Martín', email: 'familia@example.com', phone_search: null },
  { id: 'pablo', first_name: 'Pablo', last_name: 'Ruiz', email: null, phone_search: null },
]

const decide = (customer: { email?: string | null; name?: string | null; phone?: string | null }, known: string | null = null) => {
  const matchable = stripeCustomerAsMatchable(customer)
  return stripeAutoPairDecision(suggestMandatePatient(matchable, patients), matchable, known)
}

describe('what a webhook does with a subscription nobody has paired', () => {
  it('pairs on an email exactly one patient has', () => {
    expect(decide({ email: 'ANA@example.com', name: 'Ana G.' })).toEqual({ action: 'link', patientId: 'ana', by: 'email' })
  })

  it('pairs on a phone written with the country prefix', () => {
    expect(decide({ phone: '+34 612 34 56 78', name: 'Ana' })).toEqual({ action: 'link', patientId: 'ana', by: 'phone' })
  })

  it('pairs with the patient this Stripe customer already belongs to, whatever the details say', () => {
    expect(decide({ email: 'someone-else@example.com' }, 'pablo')).toEqual({ action: 'link', patientId: 'pablo', by: 'customer' })
  })

  it('leaves a shared email for a person, never picking one of the two', () => {
    expect(decide({ email: 'familia@example.com' })).toEqual({ action: 'pending', reason: 'ambiguous' })
  })

  it('does not pair on a name alone', () => {
    expect(decide({ name: 'Pablo Ruiz' })).toEqual({ action: 'pending', reason: 'name_only' })
  })

  it('creates the patient when nobody here could be them', () => {
    expect(decide({ email: 'nueva@example.com', name: 'Marta Nueva', phone: '+34 600 000 000' })).toEqual({ action: 'create' })
  })

  it('does not create a nameless patient', () => {
    expect(decide({ email: 'sin-nombre@example.com' })).toEqual({ action: 'pending', reason: 'no_details' })
  })
})

describe('reading a Stripe customer', () => {
  it('splits the name into a first name and the rest as surnames', () => {
    expect(stripeCustomerAsMatchable({ name: '  Ana   García Pérez ', email: 'a@x.es', phone: null })).toMatchObject({ given_name: 'Ana', family_name: 'García Pérez', email: 'a@x.es' })
  })
})

describe('Stripe states as memberships', () => {
  it('is active while it charges, and keeps being a member when a charge fails', () => {
    expect(stripeSubscriptionState({ status: 'active', pauseCollection: null })).toEqual({ membership: 'active', schedule: 'active' })
    expect(stripeSubscriptionState({ status: 'trialing', pauseCollection: null })).toEqual({ membership: 'active', schedule: 'active' })
    expect(stripeSubscriptionState({ status: 'past_due', pauseCollection: null })).toEqual({ membership: 'active', schedule: 'past_due' })
    expect(stripeSubscriptionState({ status: 'unpaid', pauseCollection: null })).toEqual({ membership: 'active', schedule: 'past_due' })
  })

  it('is paused when collection is paused, or Stripe paused it', () => {
    expect(stripeSubscriptionState({ status: 'active', pauseCollection: { behavior: 'void' } })).toEqual({ membership: 'paused', schedule: 'active' })
    expect(stripeSubscriptionState({ status: 'paused', pauseCollection: null })).toEqual({ membership: 'paused', schedule: 'active' })
  })

  it('is cancelled once Stripe cancels it, and nothing before its first payment', () => {
    expect(stripeSubscriptionState({ status: 'canceled', pauseCollection: null })).toEqual({ membership: 'cancelled', schedule: 'canceled' })
    expect(stripeSubscriptionState({ status: 'incomplete_expired', pauseCollection: null })).toEqual({ membership: 'cancelled', schedule: 'canceled' })
    expect(stripeSubscriptionState({ status: 'incomplete', pauseCollection: null })).toBeNull()
  })

  it('takes the price’s period, and none it cannot hold', () => {
    expect(membershipIntervalOf({ interval: 'month', interval_count: 3 })).toEqual({ interval: 'month', count: 3 })
    expect(membershipIntervalOf({ interval: 'year', interval_count: 1 })).toEqual({ interval: 'year', count: 1 })
    expect(membershipIntervalOf({ interval: 'day', interval_count: 1 })).toBeNull()
  })
})

describe('one charge arriving by two roads', () => {
  const charge = { patientId: 'ana', amountCents: 5000, paidAt: '2026-11-01T09:00:00Z' }

  it('is the same patient, amount and within three days', () => {
    expect(couldBeSameCharge(charge, { ...charge, paidAt: '2026-11-03T20:00:00Z' })).toBe(true)
    expect(couldBeSameCharge(charge, { ...charge, paidAt: '2026-11-05T09:00:00Z' })).toBe(false)
    expect(couldBeSameCharge(charge, { ...charge, amountCents: 5001 })).toBe(false)
    expect(couldBeSameCharge(charge, { ...charge, patientId: 'luis' })).toBe(false)
  })

  it('picks the closest in time', () => {
    const near = { id: 'near', ...charge, paidAt: '2026-11-01T18:00:00Z' }
    const far = { id: 'far', ...charge, paidAt: '2026-10-30T09:00:00Z' }
    expect(closestSameCharge(charge, [far, near])?.id).toBe('near')
  })

  it('pairs two monthly charges of the same amount each with its own month', () => {
    const booked = [
      { id: 'oct', patientId: 'ana', amountCents: 5000, paidAt: '2026-10-01T09:00:00Z' },
      { id: 'nov', patientId: 'ana', amountCents: 5000, paidAt: '2026-11-01T09:00:00Z' },
    ]
    const incoming = [
      { ref: 'phpay-2', patientId: 'ana', amountCents: 5000, paidAt: '2026-11-02T10:00:00Z' },
      { ref: 'phpay-1', patientId: 'ana', amountCents: 5000, paidAt: '2026-10-02T10:00:00Z' },
      { ref: 'phpay-3', patientId: 'ana', amountCents: 5000, paidAt: '2026-12-02T10:00:00Z' },
    ]
    const { adopt, rest } = pairWithBookedCharges(incoming, booked)
    expect(adopt.map((a) => [a.incoming.ref, a.bookedId])).toEqual([['phpay-2', 'nov'], ['phpay-1', 'oct']])
    expect(rest.map((r) => r.ref)).toEqual(['phpay-3'])
  })
})
