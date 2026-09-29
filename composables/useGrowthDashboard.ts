// The Growth dashboard, now computed from the clinic's own leads.
//
// Three kinds of number live on this screen and they do not come from the
// same place, which is why several of these fields are nullable:
//
//   Real from `leads`      -- the funnel, new leads, revenue attributed, and
//                             every channel count.
//   Real only with spend   -- cost per lead, cost per new patient, ROAS and
//                             the channel spend column. The money was spent
//                             inside Google Ads and Meta; until a clinic
//                             records it in channel_spend the API omits
//                             these rather than sending zero, because a zero
//                             reads as "this channel is free".
//   Not built yet          -- the AI receptionist summary, which needs a
//                             conversations table. `ai` is null and the page
//                             hides the card.

export type Tone = 'positive' | 'negative' | 'neutral'

export interface GrowthKpi {
  key: string
  label: string
  value: string
  delta: string
  tone: Tone
}

export interface GrowthFunnelStage {
  key: string
  label: string
  count: number
  caption: string
}

export interface GrowthFunnelStep {
  pct: number
  delta: string
  tone: 'neutral' | 'warning' | 'danger'
  emphasis?: boolean
}

export interface GrowthChannelRow {
  channel: string
  /** null where the clinic has recorded no spend for this channel. */
  spend: string | null
  /** The same figure unformatted, so it can be edited in place. */
  spendCents: number | null
  leads: number
  booked: number
  /** null where nothing was booked, so there is no rate to state. */
  showRate: number | null
  costPerNewPatient: string | null
}

export interface GrowthTrendPoint {
  label: string
  leads: number
  booked: number
}

export interface GrowthAlert {
  key: string
  tone: Exclude<Tone, 'positive'>
  title: string
  detail: string
}

export interface GrowthAiSummary {
  conversations: number
  booked: number
  bookRate: string
  avgReply: string
  escalated: number
}

export interface GrowthDashboardData {
  periodLabel: string
  kpis: GrowthKpi[]
  funnelStages: GrowthFunnelStage[]
  funnelSteps: GrowthFunnelStep[]
  endToEndRate: string
  dropOff: { summary: string; action: string } | null
  ai: GrowthAiSummary | null
  alerts: GrowthAlert[]
  channels: GrowthChannelRow[]
  channelTotals: GrowthChannelRow
  trend: GrowthTrendPoint[]
  trendAxis: string[]
}

// What the locked screen draws out of focus behind the upgrade card. It used
// to be the clinic's own dashboard, fetched like the real one -- but the
// endpoint answers 402 to an account without Growth, which is exactly the
// account that sees the locked screen, so it showed an error instead of the
// offer. The body is the same component either way; only the numbers are
// made up, and nobody can read them through the blur.
export const SAMPLE_GROWTH_DASHBOARD: GrowthDashboardData = (() => {
  const trend = [9, 11, 8, 13, 12, 15, 14, 17, 16, 19, 18, 21, 22].map((leads, i) => ({
    label: `W${i + 1}`,
    leads,
    booked: Math.round(leads * 0.55),
  }))
  const channels: GrowthChannelRow[] = [
    { channel: 'Meta Ads', spend: '€1,480', spendCents: 148_000, leads: 64, booked: 33, showRate: 82, costPerNewPatient: '€62' },
    { channel: 'Google Ads', spend: '€920', spendCents: 92_000, leads: 41, booked: 24, showRate: 88, costPerNewPatient: '€54' },
    { channel: 'Direct', spend: null, spendCents: null, leads: 22, booked: 14, showRate: 93, costPerNewPatient: null },
  ]
  return {
    periodLabel: 'September 2026',
    kpis: [
      { key: 'leads', label: 'New leads this month', value: '127', delta: '342 in 90 days', tone: 'neutral' },
      { key: 'cpl', label: 'Cost per lead', value: '€18.90', delta: '€2,400 spend', tone: 'neutral' },
      { key: 'cpnp', label: 'Cost per new patient', value: '€58', delta: '41 converted', tone: 'neutral' },
      { key: 'revenue', label: 'Revenue attributed', value: '€16,400', delta: 'Estimated value of converted leads', tone: 'positive' },
      { key: 'roas', label: 'ROAS', value: '6.8x', delta: '€2,400 spend', tone: 'positive' },
    ],
    funnelStages: [
      { key: 'new', label: 'New Lead', count: 127, caption: '' },
      { key: 'contacted', label: 'Contacted', count: 112, caption: '' },
      { key: 'qualified', label: 'Qualified', count: 88, caption: '' },
      { key: 'booked', label: 'Booked', count: 71, caption: '' },
      { key: 'showed', label: 'Showed', count: 60, caption: '' },
      { key: 'converted', label: 'Converted', count: 41, caption: '' },
    ],
    funnelSteps: [
      { pct: 88, delta: '−15', tone: 'neutral' },
      { pct: 79, delta: '−24', tone: 'neutral' },
      { pct: 81, delta: '−17', tone: 'neutral' },
      { pct: 85, delta: '−11', tone: 'neutral' },
      { pct: 68, delta: '−19', tone: 'warning', emphasis: true },
    ],
    endToEndRate: '32.3%',
    dropOff: { summary: 'Biggest drop-off: 19 leads did not reach Converted.', action: 'Review the pipeline' },
    ai: null,
    alerts: [
      { key: 'stale', tone: 'negative', title: '6 leads waiting more than a week', detail: 'Contacted or qualified, never booked' },
      { key: 'unattributed', tone: 'neutral', title: '3 leads with no source', detail: 'They count in the funnel but not in any channel' },
    ],
    channels,
    channelTotals: { channel: 'All channels', spend: '€2,400', spendCents: 240_000, leads: 127, booked: 71, showRate: 85, costPerNewPatient: '€58' },
    trend,
    trendAxis: [trend[0]!.label, trend[6]!.label, trend[12]!.label],
  }
})()

/**
 * `entitled` says whether this account has Growth: null while that is not yet
 * known. Nothing is fetched until it is true -- without Growth the endpoint
 * only ever answers 402.
 */
export function useGrowthDashboard(entitled: () => boolean | null) {
  const data = ref<GrowthDashboardData | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)
  const t = useT()

  async function load() {
    try {
      data.value = await useStaffFetch<GrowthDashboardData>('/api/growth/dashboard')
    } catch {
      error.value = t('Could not load the dashboard. Refresh to try again.', 'No se ha podido cargar el panel. Actualiza para reintentar.')
    } finally {
      loading.value = false
    }
  }

  /**
   * Records what was spent on a channel this month, then reloads -- cost per
   * lead, cost per new patient and ROAS all move the moment it lands, and
   * re-deriving them here would be a second implementation of the maths the
   * dashboard endpoint already does.
   */
  async function saveChannelSpend(channel: string, amountCents: number | null) {
    await useStaffFetch('/api/growth/channel-spend', { method: 'PUT', body: { channel, amountCents } })
    await load()
  }

  // Watched rather than read once: the tier can resolve to "no" and then to
  // "yes" when the account store lands after mount.
  let requested = false
  onMounted(() => {
    watch(entitled, (on) => {
      if (on && !requested) {
        requested = true
        load()
      }
    }, { immediate: true })
  })

  return { data, loading, error, saveChannelSpend, reload: load }
}
