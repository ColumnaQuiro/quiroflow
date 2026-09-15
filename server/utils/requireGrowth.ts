import type { H3Event } from 'h3'
import { requirePermission } from '~/server/utils/requirePermission'

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

  const { data: subscription } = await access.supabase
    .from('subscriptions')
    .select('growth_addon, status, comped')
    .eq('account_id', access.teamMember.account_id)
    .maybeSingle()

  if (!hasGrowth(subscription)) {
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
 * Past that, the add-on is required. 'locked' and 'canceled' are the two
 * statuses that stop it; past_due is somebody whose card failed this
 * morning, and cutting their lead capture off over that would lose enquiries
 * they have already paid for.
 */
export function hasGrowth(subscription: { growth_addon?: boolean | null; status?: string | null; comped?: boolean | null } | null): boolean {
  if (!subscription) return false
  if (subscription.comped) return true
  if (subscription.status === 'trialing') return true
  if (!subscription.growth_addon) return false
  return subscription.status !== 'locked' && subscription.status !== 'canceled'
}
