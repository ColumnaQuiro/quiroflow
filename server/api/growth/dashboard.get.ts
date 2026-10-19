import { serverSupabaseServiceRole } from '#supabase/server'
import { hasReceptionist, requireGrowth } from '~/server/utils/requireGrowth'
import { loadReceptionistActivity } from '~/server/utils/receptionistActivity'
import { leadDefaultValueCents } from '~/server/utils/leads'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, startOfLocalDate } from '~/utils/clinicClock'
import { LEAD_FUNNEL_STAGES, leadReach } from '~/utils/leadReach'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { GROWTH_DIRECT_CHANNEL, type GrowthAlertPayload, type GrowthChannelPayload, type GrowthDashboardPayload } from '~/utils/growthDashboard'

// The Growth dashboard, computed from the leads a clinic actually has.
//
// What is real here and what is not is worth stating plainly, because the
// screen reads as one board of numbers and they do not all come from the
// same place:
//
//   Funnel, new leads, revenue attributed, channel lead/booked/show counts
//     -- computed from `leads`. Real.
//   Cost per lead, cost per new patient, ROAS, channel spend
//     -- need money spent inside Google Ads and Meta. Computed only where a
//        clinic has entered spend in `channel_spend`; otherwise omitted
//        rather than shown as zero, because a zero here reads as "this
//        channel is free" instead of "we do not know".
//   AI receptionist summary
//     -- needs a conversations table that does not exist. Omitted entirely;
//        the page hides the card rather than inventing a number for it.
//
// It sends figures, not sentences. The labels are put on in the browser
// (utils/growthDashboard.ts), which knows the staff member's language; this
// used to answer in English to a Spanish front desk.

/**
 * "Meta Ads · Sciatica" -> "Meta Ads". Channel spend is recorded per channel,
 * not per campaign, so the dashboard groups the same way -- a clinic running
 * four ad variants sees one Meta Ads row, which is also how they think about
 * the budget.
 */
function channelOf(source: string | null) {
  if (!source) return GROWTH_DIRECT_CHANNEL
  const [head] = source.split('·')
  return head!.trim() || GROWTH_DIRECT_CHANNEL
}

export default defineEventHandler(async (event): Promise<GrowthDashboardPayload> => {
  const { supabase, teamMember, subscription } = await requireGrowth(event)
  const accountId = teamMember.account_id

  // "This month" is the clinic's month, not UTC's: a lead arriving at 01:00
  // in Madrid on the 1st belongs to the new month, and in UTC it is still
  // the old one.
  const { data: clinic } = await supabase
    .from('clinics')
    .select('timezone')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  const tz = clinic?.timezone || DEFAULT_CLINIC_TIMEZONE

  const now = new Date()
  const DAY = 24 * 3600 * 1000
  const month = clinicDateOf(now, tz).slice(0, 7)
  const monthStart = startOfLocalDate(`${month}-01`, tz)
  // Thirteen whole weeks for the trend, which is 91 days -- one more than
  // the "in 90 days" figure, which is counted from within it.
  const WEEKS = 13
  const windowStart = new Date(now.getTime() - WEEKS * 7 * DAY)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY)

  // Paged, both: PostgREST stops at 1000 rows without saying so, and a busy
  // clinic's 13 weeks of leads can pass that.
  const [rows, progressRows, { data: spendRows }, { count: pendingReplies }, defaultCents] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from('leads')
        .select('id, stage, furthest_stage, source, estimated_value_cents, created_at')
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .gte('created_at', windowStart.toISOString())
        .order('id')
        .range(from, to),
    ),
    // What actually happened to each lead -- messaged, booked, attended --
    // which furthest_stage alone does not say (see the migration that adds
    // it, 20261012142147_growth_lead_progress.sql).
    fetchAllRows((from, to) =>
      supabase
        .rpc('growth_lead_progress', { p_account_id: accountId, p_since: windowStart.toISOString() })
        .order('lead_id')
        .range(from, to),
    ),
    supabase
      .from('channel_spend')
      .select('channel, amount_cents')
      .eq('account_id', accountId)
      .eq('period_month', `${month}-01`),
    // Review drafts waiting for a person. Counted, not fetched -- the
    // dashboard needs the number, and the bodies belong on the Reputation
    // screen where someone can actually read them before approving.
    supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .not('draft_body', 'is', null)
      .is('replied_at', null),
    leadDefaultValueCents(supabase, accountId),
  ])

  const progress = new Map(progressRows.map((row) => [row.lead_id, row]))

  // --- What each lead reached -------------------------------------------
  // Cumulative, from furthest_stage, corrected by what actually happened:
  // a delivered message counts as Contacted, and Booked/Showed need an
  // appointment. The rule is utils/leadReach.ts, shared with Reports.
  const leads = rows.map((lead) => {
    const p = progress.get(lead.id)
    const reached = leadReach(lead.furthest_stage, p)
    return {
      ...lead,
      createdAt: new Date(lead.created_at),
      reached,
      // Whether a booked lead has had the chance to turn up. One booked for
      // next week has not missed anything yet. Without any appointment on
      // record (dragged to Booked by hand) there is no date to wait for, so
      // it counts as before.
      due: reached.showed || Boolean(p?.appointment_due) || !p?.booked,
    }
  })
  type Lead = (typeof leads)[number]

  const thisMonth = leads.filter((lead) => lead.createdAt >= monthStart)

  // 'lost' is not a step: a lead that reached Booked and was then lost still
  // reached Booked, which is the drop-off the funnel exists to show.
  const funnel = LEAD_FUNNEL_STAGES.map((stage) => ({
    key: stage,
    count: thisMonth.filter((lead) => lead.reached[stage]).length,
  }))

  // --- Spend --------------------------------------------------------------
  // Only this month's row: the filter used to be ">= this month", which
  // would have added any figure typed in ahead for next month.
  const spendByChannel = new Map<string, number>()
  for (const row of spendRows ?? []) {
    spendByChannel.set(row.channel, (spendByChannel.get(row.channel) ?? 0) + row.amount_cents)
  }
  const totalSpend = [...spendByChannel.values()].reduce((sum, cents) => sum + cents, 0)
  const hasSpend = totalSpend > 0

  const convertedThisMonth = thisMonth.filter((lead) => lead.reached.converted)
  const revenueCents = convertedThisMonth.reduce((sum, lead) => sum + (lead.estimated_value_cents ?? defaultCents ?? 0), 0)

  // --- Channels -----------------------------------------------------------
  function channelFigures(mine: Lead[], spend: number | null): Omit<GrowthChannelPayload, 'channel'> {
    const booked = mine.filter((lead) => lead.reached.booked)
    // Of the booked leads whose appointment has come round, how many came.
    const due = booked.filter((lead) => lead.due)
    const showed = due.filter((lead) => lead.reached.showed).length
    const converted = mine.filter((lead) => lead.reached.converted).length
    return {
      spendCents: spend,
      leads: mine.length,
      booked: booked.length,
      showRate: due.length === 0 ? null : Math.round((showed / due.length) * 100),
      costPerNewPatientCents: spend === null || converted === 0 ? null : Math.round(spend / converted),
    }
  }

  const channelNames = new Set<string>([...leads.map((lead) => channelOf(lead.source)), ...spendByChannel.keys()])
  const channels: GrowthChannelPayload[] = [...channelNames]
    .map((channel) => ({
      channel,
      ...channelFigures(thisMonth.filter((lead) => channelOf(lead.source) === channel), spendByChannel.get(channel) ?? null),
    }))
    .sort((a, b) => b.leads - a.leads)

  const totals = channelFigures(thisMonth, hasSpend ? totalSpend : null)

  // --- Trend --------------------------------------------------------------
  // A cohort view, not a calendar of events: of the leads that ARRIVED in a
  // week, how many ever went on to book. That answers "is what we are buying
  // any good", which is the question this chart is on the page to answer --
  // and unlike "bookings per week" it needs no record of when each lead
  // crossed each stage.
  const trend = Array.from({ length: WEEKS }, (_, i) => {
    const from = new Date(now.getTime() - (WEEKS - i) * 7 * DAY)
    const to = new Date(now.getTime() - (WEEKS - i - 1) * 7 * DAY)
    const cohort = leads.filter((lead) => lead.createdAt >= from && lead.createdAt < to)
    return {
      weekStart: clinicDateOf(from, tz),
      leads: cohort.length,
      booked: cohort.filter((lead) => lead.reached.booked).length,
    }
  })

  // --- Needs attention ----------------------------------------------------
  // Derived from the leads themselves rather than invented. Both of these are
  // things a front desk can act on this afternoon -- which is why "waiting"
  // looks back 30 days, not the whole 90: a lead untouched since summer is
  // not this afternoon's work, and counting them buried the ones that are.
  // It used to say "contacted or qualified" while most of what it counted
  // was New, so the detail now says how many were never contacted at all.
  const staleCutoff = new Date(now.getTime() - 7 * DAY)
  const staleFloor = new Date(now.getTime() - 30 * DAY)
  const stale = leads.filter(
    (lead) => lead.createdAt < staleCutoff && lead.createdAt >= staleFloor && lead.stage !== 'lost' && !lead.reached.booked && !lead.reached.converted,
  )
  const unattributed = thisMonth.filter((lead) => !lead.source).length

  const alerts: GrowthAlertPayload[] = []
  if (stale.length > 0) {
    alerts.push({ key: 'stale', count: stale.length, neverContacted: stale.filter((lead) => !lead.reached.contacted).length })
  }
  if (!hasSpend) alerts.push({ key: 'no-spend' })
  // An AI draft nobody approves is the failure mode the design tried to solve
  // with a 22-hour auto-post timer. Posting unread text under the clinic's
  // name on a public review is not an acceptable answer to it -- in a
  // healthcare business a reply can confirm that an identifiable person was a
  // patient -- so the queue is surfaced here instead. Visible beats automatic.
  if (pendingReplies && pendingReplies > 0) alerts.push({ key: 'pending-replies', count: pendingReplies })
  if (unattributed > 0) alerts.push({ key: 'unattributed', count: unattributed })

  return {
    month,
    newLeads: thisMonth.length,
    leads90d: leads.filter((lead) => lead.createdAt >= ninetyDaysAgo).length,
    spendCents: hasSpend ? totalSpend : null,
    converted: convertedThisMonth.length,
    revenueCents,
    funnel,
    channels,
    totals,
    trend,
    alerts,
    // What the receptionist did this month, from the records it leaves;
    // explicitly null without one, so the page knows the difference between
    // "no receptionist" and "failed to load".
    ai: await aiSummary(event, accountId, subscription),
  }
})

async function aiSummary(event: Parameters<typeof serverSupabaseServiceRole>[0], accountId: string, subscription: Parameters<typeof hasReceptionist>[0]) {
  if (!hasReceptionist(subscription)) return null
  try {
    const a = await loadReceptionistActivity(serverSupabaseServiceRole(event), accountId)
    return { conversations: a.month.conversations, sent: a.month.sent, drafted: a.month.drafted, booked: a.booked + a.moved, handedOver: a.handedOver }
  } catch (err) {
    // The dashboard is worth more than this card: without it, the rest.
    console.error('[growth/dashboard] could not read the receptionist activity:', (err as Error)?.message ?? err)
    return null
  }
}
