import { RECEPTIONIST_TRIAL_REPLIES, receptionistLimitReached, receptionistOnTrialAllowance } from '~/utils/receptionistAllowance'

// Counting the receptionist's replies (20261015051008_receptionist_reply_allowance.sql)
// and holding it to the clinic's monthly ceiling. Both draft functions call
// these -- lead and patient, button and tick -- so every reply it writes is
// counted once, wherever it was asked for.

/** This calendar month's replies so far, on the clinic's clock. */
export async function repliesThisMonth(client: any, accountId: string): Promise<number> {
  const { data, error } = await client.rpc('receptionist_replies_this_month', { p_account_id: accountId })
  if (error) {
    console.error('[receptionist] could not count this month\'s replies:', error.message)
    return 0
  }
  return Number(data ?? 0)
}

/**
 * Whether the clinic's ceiling stops this reply. Read before the model is
 * asked, since the model call is what costs money. Fails open on a read
 * error, like repliesThisMonth: a clinic should not lose its replies because
 * a count could not be taken.
 */
export async function overMonthlyLimit(client: any, accountId: string, limit: number | null): Promise<boolean> {
  if (!limit) return false
  return receptionistLimitReached(await repliesThisMonth(client, accountId), limit)
}

type TrialSubscription = { plan_id?: string | null; growth_addon?: boolean | null; receptionist_addon?: boolean | null; status?: string | null; comped?: boolean | null; created_at?: string | null }

/** The columns trialAllowanceUsedUp needs, for a caller that reads subscriptions itself. */
export const TRIAL_ALLOWANCE_COLUMNS = 'plan_id, growth_addon, receptionist_addon, status, comped, created_at'

/**
 * Replies written since the trial began (the subscription row's created_at),
 * for the trial's allowance. Fails open like repliesThisMonth.
 */
export async function trialRepliesUsed(client: any, accountId: string, since: string | null | undefined): Promise<number> {
  let query = client.from('receptionist_replies').select('id', { count: 'exact', head: true }).eq('account_id', accountId)
  if (since) query = query.gte('created_at', since)
  const { count, error } = await query
  if (error) {
    console.error('[receptionist] could not count the trial\'s replies:', error.message)
    return 0
  }
  return count ?? 0
}

/** Whether a subscription row already read is a trial that has used its allowance. */
export async function trialAllowanceUsedUp(client: any, accountId: string, subscription: TrialSubscription | null | undefined): Promise<boolean> {
  if (!receptionistOnTrialAllowance(subscription)) return false
  return (await trialRepliesUsed(client, accountId, subscription?.created_at)) >= RECEPTIONIST_TRIAL_REPLIES
}

/**
 * The trial's allowance as it stands -- replies used of RECEPTIONIST_TRIAL_REPLIES --
 * or null when this account is not on it (bought it, complimentary, not
 * trialing). Fails open: an unreadable subscription is null.
 */
export async function trialAllowance(client: any, accountId: string): Promise<{ used: number; limit: number } | null> {
  const { data, error } = await client.from('subscriptions').select(TRIAL_ALLOWANCE_COLUMNS).eq('account_id', accountId).maybeSingle()
  if (error) {
    console.error('[receptionist] could not read the subscription for the trial allowance:', error.message)
    return null
  }
  if (!receptionistOnTrialAllowance(data)) return null
  return { used: await trialRepliesUsed(client, accountId, data?.created_at), limit: RECEPTIONIST_TRIAL_REPLIES }
}

/**
 * Whether the trial's allowance stops this reply. Read before the model is
 * asked, like overMonthlyLimit, and fails open the same way.
 */
export async function overTrialAllowance(client: any, accountId: string): Promise<boolean> {
  const allowance = await trialAllowance(client, accountId)
  return !!allowance && allowance.used >= allowance.limit
}

/**
 * Records one reply written, sent or drafted. Never throws: a reply already
 * written must still reach the patient if the count cannot be written, and
 * the miss is logged loudly enough to find.
 */
export async function recordReceptionistReply(client: any, accountId: string, conversationKey: string, delivery: 'sent' | 'draft'): Promise<void> {
  const { error } = await client.rpc('record_receptionist_reply', { p_account_id: accountId, p_conversation_key: conversationKey, p_delivery: delivery })
  if (error) console.error(`[receptionist] could not record a reply for ${accountId} (${conversationKey}):`, error.message)
}
