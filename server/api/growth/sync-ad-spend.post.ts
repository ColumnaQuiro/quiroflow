import { requireGrowth } from '~/server/utils/requireGrowth'
import { fetchMetaAdSpend } from '~/server/utils/metaAdsSpend'

// Reads this month's Meta ad spend in, so cost per lead stops depending on
// somebody remembering to type it.
//
// Writes the same row the manual form writes, with source 'meta_ads' instead
// of 'manual' -- a column channel_spend has allowed since it was created and
// nothing has ever written. The dashboard does not care which, so nothing
// downstream changes; what changes is that the number is there.
//
// The channel is 'Meta Ads', spelled exactly as the dashboard derives it from
// a lead's source ("Meta Ads · 27/01/24 - Open - Valencia" -> "Meta Ads", via
// channelOf). Spelled any other way this would write a row that matches no
// leads, and the screen would show spend with no cost per lead beside it --
// working, and useless.
const CHANNEL = 'Meta Ads'

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)

  const { data: account } = await supabase
    .from('accounts')
    .select('meta_ads_account_id, meta_ads_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()

  const adAccountId = account?.meta_ads_account_id?.trim()
  const token = account?.meta_ads_access_token?.trim()
  if (!adAccountId || !token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Meta Ads is not connected. Add the ad account id and a read token under Settings > WhatsApp.',
    })
  }

  const month = new Date()

  let spend
  try {
    spend = await fetchMetaAdSpend(adAccountId, token, month)
  } catch (err: any) {
    // Meta's message names the actual problem -- an expired token, an ad
    // account this token cannot see -- and both are fixable by whoever
    // connected it. Replacing it with "failed" throws that away.
    const detail = err?.data?.error?.message ?? err?.message ?? 'Unknown error'
    console.error('[growth/sync-ad-spend] Meta Ads read failed:', detail)
    throw createError({ statusCode: 502, statusMessage: `Meta Ads could not be read: ${detail}` })
  }

  // No insights row means the account delivered nothing this month. Left
  // alone rather than written as zero: "we spent nothing" is a claim, and if
  // a figure was entered by hand it is a better answer than one Meta did not
  // give.
  if (!spend) return { imported: false as const, reason: 'no_delivery' as const }

  // channel_spend holds an integer with no currency beside it, and every
  // figure it has ever held is euros. A ZAR total written into it is not a
  // rounding error -- it is wrong by a factor of twenty and looks completely
  // ordinary on the dashboard. Refused rather than converted: a conversion
  // needs a rate and a date, and guessing either would be worse than saying
  // so.
  if (spend.currency && spend.currency !== 'EUR') {
    throw createError({
      statusCode: 400,
      statusMessage: `That ad account bills in ${spend.currency}. QuiroFlow records spend in euros, so this has to stay hand-entered for now.`,
    })
  }

  const periodMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).toISOString().slice(0, 10)

  const { error } = await supabase.from('channel_spend').upsert(
    {
      account_id: teamMember.account_id,
      channel: CHANNEL,
      period_month: periodMonth,
      amount_cents: spend.amountCents,
      source: 'meta_ads',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,channel,period_month' },
  )
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { imported: true as const, channel: CHANNEL, amountCents: spend.amountCents, periodMonth }
})
