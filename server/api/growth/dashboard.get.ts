import { requireGrowth } from '~/server/utils/requireGrowth'
import { LEAD_STAGES, STAGE_TITLES, formatEuros, type LeadStage } from '~/server/utils/leads'

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

/**
 * Stages that count as being on the funnel ladder, in order. 'lost' is not
 * one of them: a lead that reached Booked and was then lost still reached
 * Booked, which is the drop-off the funnel exists to show.
 */
const FUNNEL_STAGES: readonly string[] = LEAD_STAGES.filter((stage) => stage !== 'lost')

/** -1 for anything off the ladder, so `lost` never clears a threshold. */
function stageRank(stage: string) {
  return FUNNEL_STAGES.indexOf(stage)
}

/**
 * "Meta Ads · Sciatica" -> "Meta Ads". Channel spend is recorded per channel,
 * not per campaign, so the dashboard groups the same way -- a clinic running
 * four ad variants sees one Meta Ads row, which is also how they think about
 * the budget.
 */
function channelOf(source: string | null) {
  if (!source) return 'Direct'
  const [head] = source.split('·')
  return head!.trim() || 'Direct'
}

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const windowStart = new Date(now.getTime() - 90 * 24 * 3600 * 1000)

  const [{ data: rows, error }, { data: spendRows }, { count: pendingReplies }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, stage, furthest_stage, source, estimated_value_cents, created_at, converted_at')
      .eq('account_id', teamMember.account_id)
      .is('deleted_at', null)
      .gte('created_at', windowStart.toISOString()),
    supabase
      .from('channel_spend')
      .select('channel, amount_cents, period_month')
      .eq('account_id', teamMember.account_id)
      .gte('period_month', monthStart.toISOString().slice(0, 10)),
    // Review drafts waiting for a person. Counted, not fetched -- the
    // dashboard needs the number, and the bodies belong on the Reputation
    // screen where someone can actually read them before approving.
    supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', teamMember.account_id)
      .not('draft_body', 'is', null)
      .is('replied_at', null),
  ])

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const leads = rows ?? []
  const thisMonth = leads.filter((lead) => new Date(lead.created_at) >= monthStart)

  // --- Funnel -------------------------------------------------------------
  // Cumulative: a lead counts at every stage it ever reached, which is what
  // furthest_stage records. Counting current stages would report Booked as
  // whoever happens to be sitting there right now.
  const funnelStages = FUNNEL_STAGES.map((stage) => ({
    key: stage,
    // Indexed off the same map the board titles its columns from, so the
    // funnel and the pipeline can never disagree on what a stage is called.
    label: STAGE_TITLES[stage as LeadStage],
    count: thisMonth.filter((lead) => stageRank(lead.furthest_stage) >= stageRank(stage)).length,
  }))

  interface FunnelStep {
    pct: number
    delta: string
    tone: 'neutral' | 'warning' | 'danger'
    /** Set on the worst step, which the funnel renders as a filled pill. */
    emphasis?: boolean
  }

  const funnelSteps: FunnelStep[] = funnelStages.slice(1).map((stage, i) => {
    const previous = funnelStages[i]!
    const lost = previous.count - stage.count
    const pct = previous.count === 0 ? 0 : Math.round((stage.count / previous.count) * 100)
    return {
      pct,
      delta: `−${lost}`,
      // The worst surviving step is called out, not a fixed threshold: a
      // clinic converting well everywhere should not be shown a red number
      // just for having a stage below 60%.
      tone: pct >= 75 ? ('neutral' as const) : pct >= 50 ? ('warning' as const) : ('danger' as const),
    }
  })

  const worstStep = funnelSteps.reduce((worst, step, i) => (step.pct < (funnelSteps[worst]?.pct ?? 101) ? i : worst), 0)
  if (funnelSteps[worstStep] && funnelSteps.length > 0) funnelSteps[worstStep]!.emphasis = true

  const firstStage = funnelStages[0]!
  const lastStage = funnelStages[funnelStages.length - 1]!
  const endToEnd = firstStage.count === 0 ? 0 : (lastStage.count / firstStage.count) * 100

  // --- Spend and the money that depends on it -----------------------------
  const spendByChannel = new Map<string, number>()
  for (const row of spendRows ?? []) {
    spendByChannel.set(row.channel, (spendByChannel.get(row.channel) ?? 0) + row.amount_cents)
  }
  const totalSpend = [...spendByChannel.values()].reduce((sum, cents) => sum + cents, 0)
  const hasSpend = totalSpend > 0

  const convertedThisMonth = thisMonth.filter((lead) => lead.furthest_stage === 'converted')
  const revenueCents = convertedThisMonth.reduce((sum, lead) => sum + (lead.estimated_value_cents ?? 0), 0)

  const kpis: { key: string; label: string; value: string; delta: string; tone: 'positive' | 'negative' | 'neutral' }[] = [
    { key: 'leads', label: 'New leads this month', value: String(thisMonth.length), delta: `${leads.length} in 90 days`, tone: 'neutral' },
  ]

  // Only rendered when a clinic has told us what it spent. "€0.00 per lead"
  // would be a claim, not a gap.
  if (hasSpend) {
    kpis.push(
      {
        key: 'cpl',
        label: 'Cost per lead',
        value: thisMonth.length === 0 ? '—' : formatEuros(Math.round(totalSpend / thisMonth.length))!,
        delta: `${formatEuros(totalSpend)} spend`,
        tone: 'neutral',
      },
      {
        key: 'cpnp',
        label: 'Cost per new patient',
        value: convertedThisMonth.length === 0 ? '—' : formatEuros(Math.round(totalSpend / convertedThisMonth.length))!,
        delta: `${convertedThisMonth.length} converted`,
        tone: 'neutral',
      },
    )
  }

  kpis.push({
    key: 'revenue',
    label: 'Revenue attributed',
    value: formatEuros(revenueCents) ?? '€0',
    delta: 'Estimated value of converted leads',
    tone: 'neutral',
  })

  if (hasSpend) {
    kpis.push({
      key: 'roas',
      label: 'ROAS',
      value: `${(revenueCents / totalSpend).toFixed(1)}×`,
      delta: `${formatEuros(totalSpend)} spend`,
      tone: revenueCents >= totalSpend ? 'positive' : 'negative',
    })
  }

  // --- Channels -----------------------------------------------------------
  const channelNames = new Set<string>([...leads.map((lead) => channelOf(lead.source)), ...spendByChannel.keys()])
  const channels = [...channelNames]
    .map((channel) => {
      const mine = thisMonth.filter((lead) => channelOf(lead.source) === channel)
      const booked = mine.filter((lead) => stageRank(lead.furthest_stage) >= stageRank('booked')).length
      const showed = mine.filter((lead) => stageRank(lead.furthest_stage) >= stageRank('showed')).length
      const converted = mine.filter((lead) => lead.furthest_stage === 'converted').length
      const spend = spendByChannel.get(channel) ?? null
      return {
        channel,
        spend: spend === null ? null : formatEuros(spend),
        // The raw figure alongside the formatted one, so the table can put a
        // clinic back into the box it typed rather than making it re-read
        // "€1,480" and work out what to type.
        spendCents: spend,
        leads: mine.length,
        booked,
        showRate: booked === 0 ? null : Math.round((showed / booked) * 100),
        costPerNewPatient: spend === null || converted === 0 ? null : formatEuros(Math.round(spend / converted)),
      }
    })
    .sort((a, b) => b.leads - a.leads)

  const totals = {
    channel: 'All channels',
    spend: hasSpend ? formatEuros(totalSpend) : null,
    spendCents: hasSpend ? totalSpend : null,
    leads: thisMonth.length,
    booked: thisMonth.filter((lead) => stageRank(lead.furthest_stage) >= stageRank('booked')).length,
    showRate: null as number | null,
    costPerNewPatient: hasSpend && convertedThisMonth.length > 0 ? formatEuros(Math.round(totalSpend / convertedThisMonth.length)) : null,
  }
  const totalShowed = thisMonth.filter((lead) => stageRank(lead.furthest_stage) >= stageRank('showed')).length
  totals.showRate = totals.booked === 0 ? null : Math.round((totalShowed / totals.booked) * 100)

  // --- Trend --------------------------------------------------------------
  // A cohort view, not a calendar of events: of the leads that ARRIVED in a
  // week, how many ever went on to book. That answers "is what we are buying
  // any good", which is the question this chart is on the page to answer --
  // and unlike "bookings per week" it needs no record of when each lead
  // crossed each stage.
  const WEEKS = 13
  const trend = Array.from({ length: WEEKS }, (_, i) => {
    const from = new Date(now.getTime() - (WEEKS - i) * 7 * 24 * 3600 * 1000)
    const to = new Date(now.getTime() - (WEEKS - i - 1) * 7 * 24 * 3600 * 1000)
    const cohort = leads.filter((lead) => {
      const at = new Date(lead.created_at)
      return at >= from && at < to
    })
    return {
      label: from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      leads: cohort.length,
      booked: cohort.filter((lead) => stageRank(lead.furthest_stage) >= stageRank('booked')).length,
    }
  })

  // --- Needs attention ----------------------------------------------------
  // Derived from the leads themselves rather than invented. Both of these are
  // things a front desk can act on this afternoon.
  const staleCutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  const stale = leads.filter(
    (lead) => stageRank(lead.furthest_stage) >= 0 && stageRank(lead.furthest_stage) < stageRank('booked') && new Date(lead.created_at) < staleCutoff && lead.stage !== 'lost',
  )
  const unattributed = thisMonth.filter((lead) => !lead.source).length

  const alerts: { key: string; tone: 'negative' | 'neutral'; title: string; detail: string }[] = []
  if (stale.length > 0) {
    alerts.push({
      key: 'stale',
      tone: 'negative',
      title: `${stale.length} leads waiting more than a week`,
      detail: 'Contacted or qualified, never booked',
    })
  }
  if (!hasSpend) {
    alerts.push({
      key: 'no-spend',
      tone: 'neutral',
      title: 'No ad spend recorded this month',
      detail: 'Cost per lead, cost per new patient and ROAS stay hidden until it is',
    })
  }
  // An AI draft nobody approves is the failure mode the design tried to solve
  // with a 22-hour auto-post timer. Posting unread text under the clinic's
  // name on a public review is not an acceptable answer to it -- in a
  // healthcare business a reply can confirm that an identifiable person was a
  // patient -- so the queue is surfaced here instead. Visible beats automatic.
  if (pendingReplies && pendingReplies > 0) {
    alerts.push({
      key: 'pending-replies',
      tone: 'neutral',
      title: `${pendingReplies} AI ${pendingReplies === 1 ? 'reply is' : 'replies are'} waiting for approval`,
      detail: 'Drafted for reviews, and nothing posts until someone approves them',
    })
  }
  if (unattributed > 0) {
    alerts.push({
      key: 'unattributed',
      tone: 'neutral',
      title: `${unattributed} leads with no source`,
      detail: 'They count in the funnel but not in any channel',
    })
  }

  return {
    periodLabel: monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    kpis,
    funnelStages: funnelStages.map((stage) => ({ ...stage, caption: '' })),
    funnelSteps,
    endToEndRate: `${endToEnd.toFixed(1)}%`,
    dropOff:
      funnelSteps.length > 0 && funnelStages[worstStep + 1]
        ? {
            summary: `Biggest drop-off: ${funnelStages[worstStep]!.count - funnelStages[worstStep + 1]!.count} leads did not reach ${funnelStages[worstStep + 1]!.label}.`,
            action: 'Review the pipeline',
          }
        : null,
    channels,
    channelTotals: totals,
    trend,
    trendAxis: [trend[0]?.label, trend[Math.floor(WEEKS / 2)]?.label, trend[WEEKS - 1]?.label].filter(Boolean) as string[],
    alerts,
    // Explicitly null rather than absent, so the page knows the difference
    // between "no AI yet" and "failed to load".
    ai: null,
  }
})
