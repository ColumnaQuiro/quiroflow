// Reading what a clinic spent on Meta ads in a month.
//
// Reading only. Nothing in this app writes to Meta Ads, and the token asked
// for is ads_read for that reason -- a token that can only look is a token
// that cannot cost anybody money if it leaks.

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

export interface MetaAdSpend {
  /** In cents, to match channel_spend.amount_cents. */
  amountCents: number
  currency: string
}

/** First and last day of the month containing `date`, as Meta wants them. */
export function monthRange(date: Date): { since: string; until: string } {
  const since = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const until = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }
}

/**
 * Account-level spend for one month.
 *
 * The currency comes back with it and is the caller's problem to check, not
 * something to convert here. channel_spend holds an integer with no currency
 * beside it, so a ZAR figure written into a euro column is not a rounding
 * error -- it is a number that is wrong by a factor of twenty and looks
 * completely ordinary.
 */
export async function fetchMetaAdSpend(adAccountId: string, accessToken: string, month: Date): Promise<MetaAdSpend | null> {
  // Tolerate the id being pasted with or without Meta's own prefix. It is
  // shown as "act_123" in their UI and stored as "123" in their API docs, so
  // whichever an owner copies, one of them would otherwise 400.
  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
  const { since, until } = monthRange(month)

  const account = await $fetch<{ currency?: string }>(`${GRAPH_BASE}/${actId}`, {
    query: { fields: 'currency', access_token: accessToken },
    timeout: 10_000,
  })

  const insights = await $fetch<{ data?: { spend?: string }[] }>(`${GRAPH_BASE}/${actId}/insights`, {
    query: {
      fields: 'spend',
      level: 'account',
      time_range: JSON.stringify({ since, until }),
      access_token: accessToken,
    },
    timeout: 15_000,
  })

  const raw = insights.data?.[0]?.spend
  // No row at all means no delivery in that month -- not an error, and not
  // zero either. Zero would be written as "we spent nothing", which is a
  // claim; null lets the caller decide.
  if (raw === undefined) return null

  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) return null

  return {
    // Meta returns a decimal string in the account currency. Rounded rather
    // than truncated so a month of 1,479.995 does not become 1,479.99.
    amountCents: Math.round(amount * 100),
    currency: account.currency ?? '',
  }
}
