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
 * A trialing account gets Growth too: the trial is there to sell the
 * product, and the part most worth selling is the part that brings patients
 * in. A lapsed one does not, which is the whole point of the column.
 */
export function hasGrowth(subscription: { growth_addon?: boolean | null; status?: string | null; comped?: boolean | null } | null): boolean {
  if (!subscription) return false
  if (subscription.comped) return true
  if (!subscription.growth_addon) return false
  // 'locked' and 'canceled' are the two that mean stop. past_due is somebody
  // whose card failed this morning, and cutting their lead capture off over
  // that would lose enquiries they paid for.
  return subscription.status !== 'locked' && subscription.status !== 'canceled'
}
