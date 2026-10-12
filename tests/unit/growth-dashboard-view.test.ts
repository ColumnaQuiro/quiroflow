import { describe, expect, it } from 'vitest'
import { growthDashboardView, type GrowthDashboardPayload } from '../../utils/growthDashboard'

const en = (e: string) => e
const es = (_: string, s: string) => s

function payload(over: Partial<GrowthDashboardPayload> = {}): GrowthDashboardPayload {
  const funnel = (counts: number[]) =>
    ['new', 'contacted', 'qualified', 'booked', 'showed', 'converted'].map((key, i) => ({ key, count: counts[i]! }))
  return {
    month: '2026-10',
    newLeads: 87,
    leads90d: 226,
    spendCents: null,
    converted: 2,
    revenueCents: 10_000,
    funnel: funnel([87, 77, 10, 10, 3, 2]),
    channels: [{ channel: 'Direct', spendCents: null, leads: 3, booked: 0, showRate: null, costPerNewPatientCents: null }],
    totals: { spendCents: null, leads: 87, booked: 10, showRate: 50, costPerNewPatientCents: null },
    trend: [{ weekStart: '2026-07-13', leads: 4, booked: 1 }],
    alerts: [],
    ai: null,
    ...over,
  }
}

describe('growthDashboardView', () => {
  it('words the figures in the staff member\'s language', () => {
    const view = growthDashboardView(payload({ alerts: [{ key: 'unattributed', count: 1 }] }), es, 'es')
    expect(view.kpis[0]!.label).toBe('Leads nuevos este mes')
    expect(view.funnelStages.map((s) => s.label)).toContain('Contactado')
    expect(view.channels[0]!.label).toBe('Directo')
    // The key spend is saved under stays the same in every language.
    expect(view.channels[0]!.channel).toBe('Direct')
    expect(view.channelTotals.label).toBe('Todos los canales')
    expect(view.alerts[0]!.title).toBe('1 lead sin origen')
    expect(view.periodLabel).toBe('octubre de 2026')
  })

  it('caps a step at 100% when Converted outnumbers Showed', () => {
    // "Convert to patient" can come before any visit, so this is possible.
    const view = growthDashboardView(payload({ funnel: payload().funnel.map((s) => (s.key === 'converted' ? { ...s, count: 5 } : s)) }), en, 'en')
    const last = view.funnelSteps[view.funnelSteps.length - 1]!
    expect(last.pct).toBe(100)
    expect(last.delta).toBe('−0')
  })

  it('names the biggest drop-off', () => {
    const view = growthDashboardView(payload(), en, 'en')
    expect(view.dropOff?.summary).toBe('Biggest drop-off: 67 leads did not reach Qualified.')
    expect(view.funnelSteps.filter((s) => s.emphasis)).toHaveLength(1)
  })

  it('names no drop-off when there are no leads to lose', () => {
    const view = growthDashboardView(payload({ funnel: payload().funnel.map((s) => ({ ...s, count: 0 })) }), en, 'en')
    expect(view.dropOff).toBeNull()
    expect(view.funnelSteps.some((s) => s.emphasis)).toBe(false)
  })

  it('says how many waiting leads were never contacted', () => {
    const mixed = growthDashboardView(payload({ alerts: [{ key: 'stale', count: 5, neverContacted: 2 }] }), en, 'en')
    expect(mixed.alerts[0]!.title).toBe('5 leads waiting more than a week')
    expect(mixed.alerts[0]!.detail).toContain('2 never contacted')

    const contacted = growthDashboardView(payload({ alerts: [{ key: 'stale', count: 1, neverContacted: 0 }] }), en, 'en')
    expect(contacted.alerts[0]!.title).toBe('1 lead waiting more than a week')
    expect(contacted.alerts[0]!.detail).toContain('contacted but not booked')
  })

  it('shows the cost figures only once spend is recorded', () => {
    expect(growthDashboardView(payload(), en, 'en').kpis.map((k) => k.key)).toEqual(['leads', 'revenue'])
    const spent = growthDashboardView(payload({ spendCents: 20_000 }), en, 'en')
    expect(spent.kpis.map((k) => k.key)).toEqual(['leads', 'cpl', 'cpnp', 'revenue', 'roas'])
    expect(spent.kpis.find((k) => k.key === 'roas')!.value).toBe('0.5×')
  })
})
