import { receptionistLimitReached } from '~/utils/receptionistAllowance'

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

/**
 * Records one reply written, sent or drafted. Never throws: a reply already
 * written must still reach the patient if the count cannot be written, and
 * the miss is logged loudly enough to find.
 */
export async function recordReceptionistReply(client: any, accountId: string, conversationKey: string, delivery: 'sent' | 'draft'): Promise<void> {
  const { error } = await client.rpc('record_receptionist_reply', { p_account_id: accountId, p_conversation_key: conversationKey, p_delivery: delivery })
  if (error) console.error(`[receptionist] could not record a reply for ${accountId} (${conversationKey}):`, error.message)
}
