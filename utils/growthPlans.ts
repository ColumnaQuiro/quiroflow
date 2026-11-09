/**
 * Plans whose price already includes Growth.
 *
 * Lives here rather than beside either consumer because two places decide
 * this and they must not drift: requireGrowth() on the server, which is what
 * actually gates /api/growth/*, and the account store's hasGrowthAddon
 * getter, which is what decides whether the screens render. A clinic seeing
 * the Growth tabs and then getting 402 from every one of them is the exact
 * failure this prevents.
 *
 * Deliberately a plan list rather than a growth_addon flag written onto
 * Clinic subscriptions: the entitlement then cannot fall out of step with
 * the plan, and a Clinic invoice carries no Growth line item -- which is the
 * point of selling it as included.
 *
 * A third copy lives in SQL, in inbox_growth_account_ids()
 * (20260930142159_inbox_lead_messages_without_growth.sql): the Inbox list and
 * badge are computed by the database and need the same answer. Adding a plan
 * here means redefining that function too, or its clinics see each lead twice
 * -- as 20261028145810_practice_includes_growth.sql did when Practice joined.
 */
export const PLANS_INCLUDING_GROWTH = new Set(['pro', 'clinic'])

export function planIncludesGrowth(planId: string | null | undefined): boolean {
  return PLANS_INCLUDING_GROWTH.has(planId ?? '')
}

/**
 * Whether a subscription being bought carries the AI receptionist as its own
 * line item. Never alongside Growth, bought or included in the plan: Growth
 * includes the receptionist, and charging for it twice is the invoice nobody
 * can explain. So adding Growth to an account that has the receptionist
 * replaces the one with the other rather than adding to it.
 *
 * Here because subscribe.post.ts and preview.post.ts must agree: the preview
 * exists to show what subscribe will do moments later.
 */
export function receptionistLineWanted(order: { receptionist?: boolean; growth: boolean; planId: string }): boolean {
  return order.receptionist === true && !order.growth && !planIncludesGrowth(order.planId)
}

/**
 * Personal -- the team's files, contracts, documents, the gestoría pack and
 * Rentabilidad por profesional -- comes with Practice and Clinic, not Solo.
 * Decided in the Personal spec's open questions (9 Nov 2026). Here beside
 * Growth for the same reason: the account store's hasStaffSection getter and
 * the server routes that make the pack must give the same answer. A trial
 * includes it, as it includes Growth, and so does a comped account.
 */
export const PLANS_INCLUDING_STAFF = new Set(['pro', 'clinic'])

export function staffSectionIncluded(subscription: { plan_id?: string | null; status?: string | null; comped?: boolean | null } | null): boolean {
  if (!subscription) return false
  if (subscription.comped) return true
  if (subscription.status === 'trialing') return true
  if (!PLANS_INCLUDING_STAFF.has(subscription.plan_id ?? '')) return false
  return subscription.status !== 'locked' && subscription.status !== 'canceled'
}
