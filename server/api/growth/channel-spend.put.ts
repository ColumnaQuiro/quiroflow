import { requireGrowth } from '~/server/utils/requireGrowth'

// What a clinic spent on a channel this month.
//
// Three of the dashboard's numbers -- cost per lead, cost per new patient,
// ROAS -- cannot be computed from anything this app holds, because the money
// was spent inside Google Ads and Meta. Importing it needs an OAuth
// integration per platform that does not exist yet, so until then those
// figures are hidden rather than guessed, and this is how a clinic un-hides
// them: "we spent EUR 1,480 on Meta Ads in September" is a thing an owner
// knows and can type in one line.
//
// Per month, because that is how ad budgets are discussed and reported, and
// because a daily figure would demand a precision the manual path cannot
// honestly supply.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)
  const body = (await readBody<{ channel?: unknown; amountCents?: unknown; month?: unknown }>(event).catch(() => null)) ?? {}

  const channel = typeof body.channel === 'string' ? body.channel.trim() : ''
  if (!channel) throw createError({ statusCode: 400, statusMessage: 'channel is required' })
  if (channel.length > 120) throw createError({ statusCode: 400, statusMessage: 'channel is too long' })

  // Clearing is a real action, distinct from entering zero: "we did not spend
  // on this" and "we have not said what we spent" are different answers, and
  // the dashboard shows the second as a dash rather than as free leads.
  if (body.amountCents === null) {
    const { error } = await supabase
      .from('channel_spend')
      .delete()
      .eq('account_id', teamMember.account_id)
      .eq('channel', channel)
      .eq('period_month', monthOf(body.month))
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    return { channel, amountCents: null }
  }

  const amountCents = Number(body.amountCents)
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw createError({ statusCode: 400, statusMessage: 'amountCents must be a whole number of cents, or null to clear it.' })
  }

  const periodMonth = monthOf(body.month)

  const { error } = await supabase.from('channel_spend').upsert(
    {
      account_id: teamMember.account_id,
      channel,
      period_month: periodMonth,
      amount_cents: amountCents,
      // Typed by a person. An importer writing the same row later says
      // google_ads or meta_ads, which is also how it knows it may overwrite
      // a hand-entered figure rather than duplicating it.
      source: 'manual',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,channel,period_month' },
  )
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { channel, amountCents, month: periodMonth }
})

/** First day of the month, defaulting to this one. */
function monthOf(value: unknown) {
  if (typeof value === 'string' && /^\d{4}-\d{2}/.test(value)) return `${value.slice(0, 7)}-01`
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}
