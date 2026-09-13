// Shape of the Growth dashboard, plus the fixture that currently fills it.
//
// None of the underlying tables exist yet (leads, lead_events, ad spend
// imported from Google/Meta), so the numbers below are the design's own
// worked example rather than anything read from the clinic. They are kept
// here, behind the same call signature the real loader will have, so the
// screens are built against a typed shape from the start and swapping in the
// query is a change to this file only.
//
// When that lands: keep the interfaces, replace the body of
// useGrowthDashboard() with the fetch, and drop GROWTH_DASHBOARD_FIXTURE.

export type Tone = 'positive' | 'negative' | 'neutral'

export interface GrowthKpi {
  key: string
  label: string
  value: string
  /** Small pill under the value -- a delta, or a plain caption when tone is neutral. */
  delta: string
  tone: Tone
}

export interface GrowthFunnelStage {
  key: string
  label: string
  count: number
  caption: string
}

/** The gap between two stages: conversion rate and what was lost there. */
export interface GrowthFunnelStep {
  pct: number
  delta: string
  /** Colours the rate: healthy steps stay brand-coloured, weak ones warn. */
  tone: 'neutral' | 'warning' | 'danger'
  /** Renders the delta as a filled pill rather than plain text -- the worst step. */
  emphasis?: boolean
}

export interface GrowthChannelRow {
  channel: string
  /** null where the channel has no ad spend at all (referral, walk-in). */
  spend: number | null
  leads: number
  booked: number
  showRate: number
  costPerNewPatient: number | null
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
  dropOff: { summary: string; action: string }
  ai: GrowthAiSummary
  alerts: GrowthAlert[]
  channels: GrowthChannelRow[]
  channelTotals: GrowthChannelRow
  trend: GrowthTrendPoint[]
  trendAxis: string[]
}

const GROWTH_DASHBOARD_FIXTURE: GrowthDashboardData = {
  periodLabel: '1–13 September 2026',
  kpis: [
    { key: 'leads', label: 'New leads MTD', value: '412', delta: '+18% vs August', tone: 'positive' },
    { key: 'cpl', label: 'Cost per lead', value: '€7.40', delta: '−€1.10', tone: 'positive' },
    { key: 'cpnp', label: 'Cost per new patient', value: '€48.20', delta: '+€3.40', tone: 'negative' },
    { key: 'revenue', label: 'Revenue attributed', value: '€96,480', delta: 'First 90 days of care plans', tone: 'neutral' },
    { key: 'roas', label: 'ROAS', value: '4.7×', delta: '€20,620 spend', tone: 'neutral' },
  ],
  funnelStages: [
    { key: 'leads', label: 'Leads', count: 412, caption: 'Forms, calls, walk-ins' },
    { key: 'contacted', label: 'Contacted', count: 368, caption: 'AI first reply avg 38s' },
    { key: 'booked', label: 'Booked', count: 214, caption: 'Real calendar slots' },
    { key: 'showed', label: 'Showed', count: 187, caption: 'Initial Assessment' },
    { key: 'converted', label: 'Converted to care plan', count: 96, caption: 'Avg plan €1,005' },
  ],
  funnelSteps: [
    { pct: 89, delta: '−44', tone: 'neutral' },
    { pct: 58, delta: '−154 drop-off', tone: 'danger', emphasis: true },
    { pct: 87, delta: '−27 no-show', tone: 'neutral' },
    { pct: 51, delta: '−91', tone: 'warning' },
  ],
  endToEndRate: '23.3%',
  dropOff: {
    summary: 'Biggest drop-off: 154 contacted leads never booked. 61% of them stopped replying after the price question.',
    action: 'Review AI booking rules',
  },
  ai: { conversations: 148, booked: 61, bookRate: '41%', avgReply: '38s', escalated: 12 },
  alerts: [
    {
      key: 'whatsapp',
      tone: 'negative',
      title: 'WhatsApp number disconnected',
      detail: '+34 931 22 04 88 · 9 outbound messages queued',
    },
    {
      key: 'reviews',
      tone: 'neutral',
      title: '4 AI replies awaiting approval',
      detail: 'Google reviews · drafted today',
    },
  ],
  channels: [
    { channel: 'Google Ads', spend: 1480, leads: 132, booked: 71, showRate: 86, costPerNewPatient: 34.1 },
    { channel: 'Meta Ads', spend: 1120, leads: 148, booked: 68, showRate: 79, costPerNewPatient: 38.6 },
    { channel: 'Google Business Profile', spend: null, leads: 63, booked: 41, showRate: 92, costPerNewPatient: null },
    { channel: 'Patient referral', spend: null, leads: 34, booked: 28, showRate: 96, costPerNewPatient: null },
    { channel: 'Walk-in', spend: null, leads: 19, booked: 19, showRate: 100, costPerNewPatient: null },
    { channel: 'Website form', spend: null, leads: 16, booked: 9, showRate: 78, costPerNewPatient: null },
  ],
  channelTotals: {
    channel: 'All channels',
    spend: 2600,
    leads: 412,
    booked: 214,
    showRate: 87,
    costPerNewPatient: 48.2,
  },
  trend: [
    { label: '15 Jun', leads: 24, booked: 12 },
    { label: '', leads: 31, booked: 16 },
    { label: '', leads: 27, booked: 13 },
    { label: '6 Jul', leads: 38, booked: 20 },
    { label: '', leads: 35, booked: 18 },
    { label: '', leads: 44, booked: 23 },
    { label: '27 Jul', leads: 41, booked: 21 },
    { label: '', leads: 50, booked: 27 },
    { label: '', leads: 47, booked: 25 },
    { label: '17 Aug', leads: 56, booked: 30 },
    { label: '', leads: 53, booked: 28 },
    { label: '', leads: 61, booked: 34 },
    { label: '', leads: 59, booked: 32 },
    { label: '13 Sep', leads: 66, booked: 38 },
  ],
  trendAxis: ['15 Jun', '6 Jul', '27 Jul', '17 Aug', '13 Sep'],
}

export function useGrowthDashboard() {
  const data = ref<GrowthDashboardData | null>(null)
  const loading = ref(true)

  // onMounted rather than a top-level assignment so the skeleton is what
  // renders on the server -- the real loader will be async and this keeps the
  // markup identical either side of that change.
  onMounted(() => {
    data.value = GROWTH_DASHBOARD_FIXTURE
    loading.value = false
  })

  return { data, loading }
}
