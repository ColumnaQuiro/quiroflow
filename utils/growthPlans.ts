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
 * here means redefining that function too, or its clinics see each lead twice.
 */
export const PLANS_INCLUDING_GROWTH = new Set(['clinic'])

export function planIncludesGrowth(planId: string | null | undefined): boolean {
  return PLANS_INCLUDING_GROWTH.has(planId ?? '')
}
