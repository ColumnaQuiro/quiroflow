import { describe, expect, it } from 'vitest'
import { leadReach } from '../../utils/leadReach'
import { computeMetric, METRIC_BY_KEY, type LeadRow, type ReportData } from '../../utils/reportMetrics'

const none = { contacted: false, booked: false, attended: false, appointment_due: false }

describe('leadReach', () => {
  it('reads furthest_stage cumulatively', () => {
    expect(leadReach('booked')).toEqual({ new: true, contacted: true, qualified: true, booked: true, showed: false, converted: false })
    expect(leadReach('new')).toEqual({ new: true, contacted: false, qualified: false, booked: false, showed: false, converted: false })
  })

  it('counts a lead the clinic has written to as contacted, though it sits in New', () => {
    expect(leadReach('new', { ...none, contacted: true }).contacted).toBe(true)
    expect(leadReach('new', { ...none, contacted: true }).qualified).toBe(false)
  })

  it('does not credit a converted lead with a visit it has not had', () => {
    const r = leadReach('converted', none)
    expect([r.converted, r.booked, r.showed]).toEqual([true, false, false])
    const booked = leadReach('converted', { ...none, booked: true })
    expect([booked.booked, booked.showed]).toEqual([true, false])
    const came = leadReach('converted', { ...none, booked: true, attended: true })
    expect([came.booked, came.showed]).toEqual([true, true])
  })

  it('counts an appointment the stage has not caught up with', () => {
    expect(leadReach('contacted', { ...none, booked: true }).booked).toBe(true)
  })
})

describe('the Reports lead funnel', () => {
  const june = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30, 23, 59, 59, 999), now: new Date(2026, 5, 30), t: (en: string) => en }
  const lead = (over: Partial<LeadRow>): LeadRow => ({ at: new Date(2026, 5, 10).getTime(), stage: 'new', furthest_stage: 'new', source: null, estimated_value_cents: null, ...over })
  const data = (leads: LeadRow[]) => ({ leads: () => ({ leads, spend: [], defaultValueCents: null }) }) as unknown as ReportData

  it('counts the way the Growth dashboard does', () => {
    const leads = [
      lead({ reached: leadReach('new', { ...none, contacted: true }) }),
      lead({ reached: leadReach('new', none) }),
      lead({ furthest_stage: 'converted', stage: 'converted', reached: leadReach('converted', none) }),
    ]
    const r = computeMetric(METRIC_BY_KEY.get('lead_funnel')!, 'none', data(leads), june)
    expect(r.steps!.map((s) => s.value)).toEqual([3, 2, 1, 0, 0, 1])
  })
})
