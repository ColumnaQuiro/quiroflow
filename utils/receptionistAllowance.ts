// Relative, not `~`: the staff app auto-imports this directory too, and
// there `~` is mobile/.
import { planIncludesGrowth } from './growthPlans'

// What the receptionist's price includes, and what it costs past that.
//
// Priced on measured cost (20261014184755_receptionist_addon.sql): a reply is
// about 0.009 USD in model calls, so 1,000 a month are included in the add-on
// (and in Growth) and each further 1,000, or part of one, is EUR 15. Counted
// per calendar month on the clinic's clock (receptionist_replies_this_month).
//
// One place for the numbers: the usage card, the warnings, the Billing copy
// and the monthly charge all read them here, so the screen cannot promise one
// allowance while the invoice applies another.

export const RECEPTIONIST_INCLUDED_REPLIES = 1000
export const RECEPTIONIST_BLOCK_REPLIES = 1000
/** Per block past the allowance, ex-IVA. */
export const RECEPTIONIST_BLOCK_PRICE_CENTS = 1500

/**
 * What the free trial gets before anything is bought: enough replies to see
 * it answer and book (a first visit takes 5-8), not a month's worth for
 * nothing -- the trial is charged for none of them. Counted over the whole
 * trial, not per calendar month, so a trial that crosses the 1st does not get
 * it twice. Buying it (the add-on, Growth, or a plan with Growth) lifts it;
 * the replies already written still count toward that month's included 1,000.
 */
export const RECEPTIONIST_TRIAL_REPLIES = 200

type TrialAllowanceSubscription = { plan_id?: string | null; growth_addon?: boolean | null; receptionist_addon?: boolean | null; status?: string | null; comped?: boolean | null }

/** Bought something that includes the receptionist: the add-on, Growth, or a plan with Growth. */
export function receptionistPurchased(subscription: TrialAllowanceSubscription | null | undefined): boolean {
  return !!(subscription && (subscription.growth_addon || planIncludesGrowth(subscription.plan_id) || subscription.receptionist_addon))
}

/**
 * Whether this account's receptionist runs on the trial's allowance
 * (RECEPTIONIST_TRIAL_REPLIES) rather than the paid month: trialing, not
 * complimentary, and nothing bought that includes it.
 */
export function receptionistOnTrialAllowance(subscription: TrialAllowanceSubscription | null | undefined): boolean {
  if (!subscription || subscription.comped) return false
  return subscription.status === 'trialing' && !receptionistPurchased(subscription)
}

/** Blocks of 1,000 past the allowance -- a part block counts as a whole one. */
export function receptionistExtraBlocks(replies: number): number {
  const over = replies - RECEPTIONIST_INCLUDED_REPLIES
  return over > 0 ? Math.ceil(over / RECEPTIONIST_BLOCK_REPLIES) : 0
}

/**
 * How far into the allowance a month is, for the warnings: 'near' from 80%,
 * 'over' once the included replies are used up.
 */
export function receptionistAllowanceLevel(replies: number): 'ok' | 'near' | 'over' {
  if (replies >= RECEPTIONIST_INCLUDED_REPLIES) return 'over'
  if (replies >= RECEPTIONIST_INCLUDED_REPLIES * 0.8) return 'near'
  return 'ok'
}

/** Whether the clinic's own monthly ceiling (null: none) stops it writing. */
export function receptionistLimitReached(replies: number, limit: number | null | undefined): boolean {
  return typeof limit === 'number' && limit > 0 && replies >= limit
}

/** The month before `today` (YYYY-MM-DD on the clinic's clock), as its first day. */
export function previousMonthStart(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number]
  const year = m === 1 ? y - 1 : y
  const month = m === 1 ? 12 : m - 1
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/** "octubre de 2026", for the invoice line a Spanish clinic reads. */
export function monthNameEs(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
