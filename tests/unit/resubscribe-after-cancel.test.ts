import { describe, it, expect } from 'vitest'
import { canChangeInPlace, isSupersededSubscriptionEvent } from '../../utils/billing'

// An account that cancelled could never pay again.
//
// The webhook mirrors a cancellation as status 'canceled' and keeps the
// Stripe subscription id on the row. subscribe.post.ts read "there is an id"
// as "update that subscription", Stripe refuses to update a cancelled one,
// and the owner got a 500 from every attempt -- stuck on the lock screen with
// a customer, a card and no way to use them. These are the two rules that
// replace it: which subscriptions can still be changed in place (the rest go
// through Checkout), and which webhook events are about a subscription the
// account has since replaced.

describe('Which Stripe subscriptions can be changed in place', () => {
  it('accepts every status that still has a billing relationship behind it', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused']) {
      expect(canChangeInPlace(status), status).toBe(true)
    }
  })

  it('sends the ended and the never-started to Checkout instead', () => {
    for (const status of ['canceled', 'incomplete', 'incomplete_expired']) {
      expect(canChangeInPlace(status), status).toBe(false)
    }
  })
})

describe('Events about a subscription the account has moved on from', () => {
  const OLD = 'sub_old'
  const NEW = 'sub_new'

  // The failure this prevents: resubscribing creates a second Stripe
  // subscription, Stripe delivers events in no promised order, and a late
  // `deleted` for the old one would overwrite the new one's row -- locking an
  // account the moment after it paid.
  it('ignores a late cancellation of the old subscription', () => {
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: NEW, eventSubscriptionId: OLD, eventStatus: 'canceled', deleted: true })).toBe(true)
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: NEW, eventSubscriptionId: OLD, eventStatus: 'canceled', deleted: false })).toBe(true)
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: NEW, eventSubscriptionId: OLD, eventStatus: 'incomplete_expired', deleted: false })).toBe(true)
  })

  it('applies the new subscription replacing the old one', () => {
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: OLD, eventSubscriptionId: NEW, eventStatus: 'active', deleted: false })).toBe(false)
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: OLD, eventSubscriptionId: NEW, eventStatus: 'trialing', deleted: false })).toBe(false)
  })

  it('always applies events about the subscription the row already holds, including its own cancellation', () => {
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: OLD, eventSubscriptionId: OLD, eventStatus: 'canceled', deleted: true })).toBe(false)
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: OLD, eventSubscriptionId: OLD, eventStatus: 'past_due', deleted: false })).toBe(false)
  })

  it('applies anything to a row that has never had a subscription -- that is how the first one is recorded', () => {
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: null, eventSubscriptionId: NEW, eventStatus: 'incomplete', deleted: false })).toBe(false)
    expect(isSupersededSubscriptionEvent({ rowSubscriptionId: undefined, eventSubscriptionId: NEW, eventStatus: 'active', deleted: false })).toBe(false)
  })
})
