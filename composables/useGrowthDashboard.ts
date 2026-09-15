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

export function useGrowthDashboard() {
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

  onMounted(load)

  return { data, loading, error, saveChannelSpend, reload: load }
}
