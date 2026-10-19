import type { GrowthDashboardData, GrowthDashboardPayload } from '~/utils/growthDashboard'

// The Growth dashboard, computed from the clinic's own leads.
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
//
// The endpoint sends figures; the words are put on them here
// (utils/growthDashboard.ts), in the staff member's own language.

// What the locked screen draws out of focus behind the upgrade card. It used
// to be the clinic's own dashboard, fetched like the real one -- but the
// endpoint answers 402 to an account without Growth, which is exactly the
// account that sees the locked screen, so it showed an error instead of the
// offer. The body is the same component either way; only the numbers are
// made up, and nobody can read them through the blur. A payload rather than
// a finished view, so it goes through the same wording as the real one.
export const SAMPLE_GROWTH_DASHBOARD: GrowthDashboardPayload = (() => {
  const trend = [9, 11, 8, 13, 12, 15, 14, 17, 16, 19, 18, 21, 22].map((leads, i) => ({
    weekStart: new Date(Date.UTC(2026, 6, 6 + i * 7)).toISOString().slice(0, 10),
    leads,
    booked: Math.round(leads * 0.55),
  }))
  return {
    month: '2026-09',
    newLeads: 127,
    leads90d: 342,
    spendCents: 240_000,
    converted: 41,
    revenueCents: 1_640_000,
    funnel: [
      { key: 'new', count: 127 },
      { key: 'contacted', count: 112 },
      { key: 'qualified', count: 88 },
      { key: 'booked', count: 71 },
      { key: 'showed', count: 60 },
      { key: 'converted', count: 41 },
    ],
    channels: [
      { channel: 'Meta Ads', spendCents: 148_000, leads: 64, booked: 33, showRate: 82, costPerNewPatientCents: 6_200 },
      { channel: 'Google Ads', spendCents: 92_000, leads: 41, booked: 24, showRate: 88, costPerNewPatientCents: 5_400 },
      { channel: 'Direct', spendCents: null, leads: 22, booked: 14, showRate: 93, costPerNewPatientCents: null },
    ],
    totals: { spendCents: 240_000, leads: 127, booked: 71, showRate: 85, costPerNewPatientCents: 5_800 },
    trend,
    alerts: [
      { key: 'stale', count: 6, neverContacted: 2 },
      { key: 'unattributed', count: 3 },
    ],
    ai: { conversations: 148, sent: 203, drafted: 61, booked: 58, handedOver: 9 },
  }
})()

/** The payload worded for whoever is looking at it. */
export function useGrowthDashboardView(payload: () => GrowthDashboardPayload | null) {
  const t = useT()
  const { preference } = useLang()
  return computed<GrowthDashboardData | null>(() => {
    const p = payload()
    return p ? growthDashboardView(p, t, preference.value === 'es' ? 'es' : 'en') : null
  })
}

/**
 * `entitled` says whether this account has Growth: null while that is not yet
 * known. Nothing is fetched until it is true -- without Growth the endpoint
 * only ever answers 402.
 */
export function useGrowthDashboard(entitled: () => boolean | null) {
  const payload = ref<GrowthDashboardPayload | null>(null)
  const data = useGrowthDashboardView(() => payload.value)
  const loading = ref(true)
  const error = ref<string | null>(null)
  const t = useT()

  async function load() {
    try {
      payload.value = await useStaffFetch<GrowthDashboardPayload>('/api/growth/dashboard')
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
   *
   * Saved against the month on screen, which is the clinic's month. Left to
   * itself the endpoint picks the UTC one, and for the first hours of a
   * month in Madrid that is still the previous month: the figure would be
   * saved and then not appear.
   */
  async function saveChannelSpend(channel: string, amountCents: number | null) {
    await useStaffFetch('/api/growth/channel-spend', { method: 'PUT', body: { channel, amountCents, month: payload.value?.month } })
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
