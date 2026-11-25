// GoCardless subscriptions another app created (PracticeHub, on a clinic
// moving across), kept collecting where they are and booked here as patient
// memberships: the decisions, worked out without a database or GoCardless.
// The writes are in server/utils/gocardlessSubscriptionImport.ts; the screen
// is components/import/GoCardlessMandates.vue.
//
// Why keep them instead of replacing them: GoCardless (support, 17 Nov 2026)
// lets a partner read and cancel another app's subscription but never change
// it, and sends the payer an email both when it is cancelled and when ours is
// created. Kept, the patient notices nothing; its payments still reach our
// webhook. A change of amount or day is then the moment to replace it with a
// subscription of ours.
//
// Pure: no database, no network.

import { mandateNameKey } from '~/utils/gocardlessMatch'

/** A GoCardless interval in the vocabulary patient_memberships uses (week | month | year). */
export function membershipIntervalOfGoCardless(unit: string | null | undefined, count: number | null | undefined): { interval: 'week' | 'month' | 'year'; count: number } {
  const interval = unit === 'weekly' ? 'week' : unit === 'yearly' ? 'year' : 'month'
  return { interval, count: Math.min(Math.max(count ?? 1, 1), 12) }
}

/**
 * What a subscription's GoCardless status makes the membership, or null when
 * it is not collecting and should not be brought in: one waiting on (or
 * refused) the payer's approval, or already cancelled or finished.
 */
export function goCardlessSubscriptionMembershipStatus(status: string): 'active' | 'paused' | null {
  if (status === 'active') return 'active'
  if (status === 'paused') return 'paused'
  return null
}

export interface ImportablePlan {
  id: string
  name: string
  price_cents: number
  billing_interval: string
  billing_interval_count: number
}

export interface ImportableSubscription {
  name: string | null
  amountCents: number
  intervalUnit: string
  interval: number
}

/**
 * The plan in the clinic's catalogue a subscription most likely is, for the
 * screen to preselect. A person confirms it either way.
 *
 * The same name wins outright (accents, case and punctuation aside): the
 * clinic usually named the plan the way it named it in PracticeHub. Failing
 * that, the one plan with the same price on the same cadence. Two plans that
 * fit equally well suggest neither.
 */
export function suggestPlanForSubscription(sub: ImportableSubscription, plans: ImportablePlan[]): { planId: string; by: 'name' | 'price' } | null {
  const key = mandateNameKey(sub.name)
  if (key) {
    const named = plans.filter((p) => mandateNameKey(p.name) === key)
    if (named.length === 1) return { planId: named[0]!.id, by: 'name' }
  }
  const cadence = membershipIntervalOfGoCardless(sub.intervalUnit, sub.interval)
  const priced = plans.filter((p) => p.price_cents === sub.amountCents && p.billing_interval === cadence.interval && (p.billing_interval_count || 1) === cadence.count)
  return priced.length === 1 ? { planId: priced[0]!.id, by: 'price' } : null
}
