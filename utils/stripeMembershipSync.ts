// Stripe subscriptions made outside QuiroFlow, as patient memberships: the
// decisions, worked out without a database or Stripe. The writes are in
// server/utils/stripeMembershipSync.ts; the screen is
// components/import/StripeSubscriptions.vue.
//
// Pure: no database, no network.

import type { MandateMatch, MatchableCustomer } from '~/utils/gocardlessMatch'

/** The Stripe subscription statuses, as the API spells them. */
export type StripeSubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused'

export interface StripeSubscriptionStateInput {
  status: string
  /** `pause_collection` on the subscription: set while the clinic has paused charging it. */
  pauseCollection: unknown
}

export interface StripeSubscriptionState {
  /** What patient_memberships.status becomes. */
  membership: 'active' | 'paused' | 'cancelled'
  /** What payment_schedules.status becomes. */
  schedule: 'active' | 'past_due' | 'canceled'
}

/**
 * What a subscription's state in Stripe means here, or null when it is not a
 * membership yet (`incomplete`: its first payment has not gone through) and
 * should not be paired.
 *
 * - Paused collection, or Stripe's own `paused` (a trial that ended with no
 *   card), is a paused membership: nothing is being charged.
 * - `past_due` / `unpaid` keep the membership: the patient is still a member
 *   whose card failed, which is what the schedule's past_due says.
 * - `cancel_at_period_end` changes nothing until Stripe actually cancels it,
 *   which arrives as its own event.
 */
export function stripeSubscriptionState(input: StripeSubscriptionStateInput): StripeSubscriptionState | null {
  switch (input.status) {
    case 'canceled':
    case 'incomplete_expired':
      return { membership: 'cancelled', schedule: 'canceled' }
    case 'incomplete':
      return null
    case 'paused':
      return { membership: 'paused', schedule: 'active' }
    case 'past_due':
    case 'unpaid':
      return { membership: input.pauseCollection ? 'paused' : 'active', schedule: 'past_due' }
    default:
      return { membership: input.pauseCollection ? 'paused' : 'active', schedule: 'active' }
  }
}

/** A Stripe customer, as the GoCardless matcher reads one. */
export function stripeCustomerAsMatchable(customer: { email?: string | null; name?: string | null; phone?: string | null; metadata?: Record<string, string> | null }): MatchableCustomer {
  const [given, ...rest] = (customer.name ?? '').trim().split(/\s+/).filter(Boolean)
  return {
    email: customer.email ?? null,
    given_name: given ?? null,
    family_name: rest.join(' ') || null,
    company_name: null,
    phone_number: customer.phone ?? null,
    metadata: customer.metadata ?? null,
  }
}

export type StripePairDecision =
  | { action: 'link'; patientId: string; by: 'customer' | 'metadata' | 'email' | 'phone' | 'name' }
  | { action: 'create' }
  | { action: 'pending'; reason: 'ambiguous' | 'name_only' | 'no_details' }

/**
 * What a webhook does with a subscription nobody has paired yet, given who
 * the matcher thinks its customer is.
 *
 * Paired on its own only when the evidence is one person's: this Stripe
 * customer already being that patient's, our id on the customer, or an email
 * or phone that exactly one patient has. A name alone is a suggestion for
 * the screen -- two people share a name far more often than an email.
 * When nobody matches by anything, the patient is new and is created, as long
 * as the customer gives a name to create them under. Anything ambiguous
 * waits on the screen for a person.
 */
export function stripeAutoPairDecision(match: MandateMatch, customer: MatchableCustomer, knownPatientId: string | null): StripePairDecision {
  if (knownPatientId) return { action: 'link', patientId: knownPatientId, by: 'customer' }
  if (match.patientId) {
    if (match.by === 'name') return { action: 'pending', reason: 'name_only' }
    return { action: 'link', patientId: match.patientId, by: match.by }
  }
  if (match.ambiguous) return { action: 'pending', reason: 'ambiguous' }
  if (!customer.given_name) return { action: 'pending', reason: 'no_details' }
  return { action: 'create' }
}

/** The period a Stripe price recurs on, in the vocabulary patient_memberships accepts (week | month | year), or null for one it cannot hold (daily). */
export function membershipIntervalOf(recurring: { interval?: string | null; interval_count?: number | null } | null | undefined): { interval: 'week' | 'month' | 'year'; count: number } | null {
  const interval = recurring?.interval
  if (interval !== 'week' && interval !== 'month' && interval !== 'year') return null
  const count = Math.min(Math.max(recurring?.interval_count ?? 1, 1), 12)
  return { interval, count }
}

// --- the same money arriving by two roads --------------------------------------------

/**
 * A payment as both sides of the de-duplication see it. `paidAt` is an ISO
 * timestamp.
 */
export interface ComparablePayment {
  patientId: string
  amountCents: number
  paidAt: string
}

/** How far apart the two records of one charge can be. PracticeHub stamps the day it saw the charge, which can trail Stripe's by a weekend. */
export const SAME_CHARGE_WINDOW_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/** Whether two payments could be one charge: the same patient, the same amount, within the window. */
export function couldBeSameCharge(a: ComparablePayment, b: ComparablePayment): boolean {
  if (a.patientId !== b.patientId || a.amountCents !== b.amountCents) return false
  const gap = Math.abs(new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime())
  return Number.isFinite(gap) && gap <= SAME_CHARGE_WINDOW_DAYS * DAY_MS
}

/**
 * The one candidate that is this charge, or null: the closest in time among
 * those that could be, so two monthly charges of the same amount pair with
 * their own months rather than both with the nearer one.
 */
export function closestSameCharge<T extends ComparablePayment>(charge: ComparablePayment, candidates: T[]): T | null {
  let best: T | null = null
  let bestGap = Infinity
  for (const c of candidates) {
    if (!couldBeSameCharge(charge, c)) continue
    const gap = Math.abs(new Date(c.paidAt).getTime() - new Date(charge.paidAt).getTime())
    if (gap < bestGap) {
      best = c
      bestGap = gap
    }
  }
  return best
}

/**
 * Pairs incoming payments (a PracticeHub ledger run) with charges the Stripe
 * webhook already booked, each booked charge at most once, so the import
 * adopts those instead of creating a second payment for the same money.
 * What is left is imported as usual.
 */
export function pairWithBookedCharges<T extends ComparablePayment, B extends ComparablePayment & { id: string }>(incoming: T[], booked: B[]): { adopt: { incoming: T; bookedId: string }[]; rest: T[] } {
  const free = [...booked]
  const adopt: { incoming: T; bookedId: string }[] = []
  const rest: T[] = []
  for (const item of incoming) {
    const hit = closestSameCharge(item, free)
    if (hit) {
      free.splice(free.indexOf(hit), 1)
      adopt.push({ incoming: item, bookedId: hit.id })
    } else {
      rest.push(item)
    }
  }
  return { adopt, rest }
}
