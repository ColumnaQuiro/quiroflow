import type { H3Event } from 'h3'
import { requirePermission } from '~/server/utils/requirePermission'
import { planIncludesGrowth } from '~/utils/growthPlans'

// Growth is a paid add-on, and this is where that is true.
//
// It used to be true only in the browser: useGrowthTier read a flag out of
// localStorage, and every /api/growth/* route checked the
// communication_config permission and nothing else. So any account on any
// plan could call the entire Growth API, and the tier was a suggestion the
// UI made rather than something the product enforced.
//
// Two separate questions, deliberately kept apart and answered in this
// order:
//
//   permission  -- may THIS person use Growth for this account?
//   entitlement -- has this ACCOUNT bought Growth at all?
//
// Permission first, so someone without it gets 403 rather than learning
// what the clinic does or does not pay for.

export type GrowthAccess = Awaited<ReturnType<typeof requirePermission>>

export async function requireGrowth(event: H3Event): Promise<GrowthAccess> {
  const access = await requirePermission(event, 'communication_config')

  // Read alongside the team member in requireActiveAccount, one round trip
  // rather than two; none or several rows arrive as null, as .maybeSingle()
  // gave them here before.
  if (!hasGrowth(access.subscription)) {
    throw createError({
      statusCode: 402,
      statusMessage: 'Growth is not on this subscription. Add it under Billing to use leads, the AI receptionist and reputation.',
    })
  }

  return access
}

/**
 * Comped accounts get everything -- that row exists so QuiroFlow's own
 * account appears in the customer list like any other, not to bill it.
 *
 * A trial includes Growth, without having bought the add-on. The trial
 * exists to sell the product and this is the part most worth selling, so
 * hiding it behind a purchase during the one period a clinic is deciding
 * would be the wrong way round. It does mean a cliff when the trial ends --
 * lead capture stops until they buy -- which is why the refusal says so in
 * words rather than failing quietly.
 *
 * The Practice and Clinic plans include Growth in their price, so they are
 * entitled without growth_addon ever being set. That is a packaging decision,
 * not a flag: such a subscription has no Growth line item on its Stripe invoice, because
 * charging 39 euros on top of a plan sold as "Growth included" is exactly the
 * bill nobody wants to explain. Read the plan here rather than writing
 * growth_addon = true on those rows, so the entitlement cannot drift from what
 * the plan actually is.
 *
 * Past that, the add-on is required. 'locked' and 'canceled' are the two
 * statuses that stop it; past_due is somebody whose card failed this
 * morning, and cutting their lead capture off over that would lose enquiries
 * they have already paid for.
 */
export function hasGrowth(
  subscription: { plan_id?: string | null; growth_addon?: boolean | null; status?: string | null; comped?: boolean | null } | null,
): boolean {
  if (!subscription) return false
  if (subscription.comped) return true
  if (subscription.status === 'trialing') return true
  const entitled = subscription.growth_addon || planIncludesGrowth(subscription.plan_id)
  if (!entitled) return false
  return subscription.status !== 'locked' && subscription.status !== 'canceled'
}

// The AI receptionist, which Growth includes and which is also sold on its
// own (20261014184755_receptionist_addon.sql). Its own question rather than
// hasGrowth(), because an account with only the receptionist must get it
// without the lead pipeline, reputation and the rest of Growth -- and the
// account store's hasReceptionist getter must give the same answer.

export function hasReceptionist(
  subscription: { plan_id?: string | null; growth_addon?: boolean | null; receptionist_addon?: boolean | null; status?: string | null; comped?: boolean | null } | null,
): boolean {
  if (hasGrowth(subscription)) return true
  if (!subscription?.receptionist_addon) return false
  // The same two statuses that stop Growth stop this; past_due keeps it, for
  // the reason hasGrowth gives.
  return subscription.status !== 'locked' && subscription.status !== 'canceled'
}

/**
 * How the account comes to have the receptionist, for the settings page's
 * header: the same reading as the Subscription page's card, so the two
 * screens cannot disagree about why a clinic is or is not charged for it.
 */
export type ReceptionistIncludedBy = 'comped' | 'trial' | 'growth' | 'addon' | null

export function receptionistIncludedBy(
  subscription: { plan_id?: string | null; growth_addon?: boolean | null; receptionist_addon?: boolean | null; status?: string | null; comped?: boolean | null } | null,
): ReceptionistIncludedBy {
  if (!subscription) return null
  if (subscription.comped) return 'comped'
  if (subscription.status === 'trialing') return 'trial'
  if (subscription.status === 'locked' || subscription.status === 'canceled') return null
  if (subscription.growth_addon || planIncludesGrowth(subscription.plan_id)) return 'growth'
  if (subscription.receptionist_addon) return 'addon'
  return null
}

/** requireGrowth's two questions, in the same order, for the receptionist's own routes. */
export async function requireReceptionist(event: H3Event): Promise<GrowthAccess> {
  const access = await requirePermission(event, 'communication_config')
  if (!hasReceptionist(access.subscription)) {
    throw createError({
      statusCode: 402,
      statusMessage: 'The AI receptionist is not on this subscription. Add it, or Growth, under Billing.',
    })
  }
  return access
}
