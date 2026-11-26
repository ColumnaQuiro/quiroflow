/**
 * Who has Blind Spot (punto ciego), and which app an account sees.
 *
 * Three readers must give the same answer: the server (requireBlindSpot in
 * server/utils/requireGrowth.ts, which gates the PDF), the account store's
 * hasBlindSpot getter (which decides whether the tab and the test render)
 * and account_has_blind_spot() in the database, which refuses a new test
 * under RLS (20261126082211_blind_spot.sql). Change one, change all three.
 *
 * Comped has it. Locked and cancelled keep nothing new -- the tests already
 * taken stay readable, which RLS does not tie to the entitlement. A trial
 * includes it, as it includes Growth: the trial is when a clinic decides.
 * Past that, the add-on (subscriptions.blind_spot_addon) or the Blind Spot
 * plan, which is the standalone product.
 */
export const BLIND_SPOT_PLAN_ID = 'blind_spot'

export type AccountProduct = 'clinic' | 'blind_spot'

export function blindSpotIncluded(
  subscription: { plan_id?: string | null; blind_spot_addon?: boolean | null; status?: string | null; comped?: boolean | null } | null,
): boolean {
  if (!subscription) return false
  if (subscription.comped) return true
  if (subscription.status === 'locked' || subscription.status === 'canceled') return false
  if (subscription.status === 'trialing') return true
  return !!subscription.blind_spot_addon || subscription.plan_id === BLIND_SPOT_PLAN_ID
}

/**
 * The pages an account that bought only Blind Spot can open. Everything else
 * is the clinic-management product it did not buy, and the route guard
 * (utils/routePermissions.ts) sends it to /blind-spot instead. Account-level
 * pages (your own account, two-factor, the subscription) stay, so the owner
 * can pay and can move to the whole of QuiroFlow; so do the team pages, so a
 * clinic can add the colleague who runs the test.
 */
const BLIND_SPOT_ONLY_PREFIXES = ['/blind-spot', '/patients', '/subscription', '/account', '/two-factor', '/settings/team', '/settings/roles', '/settings/privacy', '/settings/activity']

export function blindSpotOnlyAllows(path: string): boolean {
  if (path === '/patients/import') return false
  return BLIND_SPOT_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}
