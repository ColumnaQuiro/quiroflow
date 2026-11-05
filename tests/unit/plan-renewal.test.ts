import { describe, expect, it } from 'vitest'
import { dischargeRecallDate, maintenanceConfig, maintenancePreset, openEndedPlanLabel, planVisitsToBook, previousCadence, renewalDue } from '../../utils/planRenewal'

const en = (e: string) => e
const es = (_e: string, s: string) => s

describe('renewalDue', () => {
  it('flags a plan with two visits or fewer left, and not one without visits', () => {
    expect(renewalDue({ total_visits: 12 }, 9)).toBe(false)
    expect(renewalDue({ total_visits: 12 }, 10)).toBe(true)
    expect(renewalDue({ total_visits: 12 }, 12)).toBe(true)
    expect(renewalDue({ total_visits: 0 }, 0)).toBe(false)
  })
  it('never flags a plan with no end', () => {
    expect(renewalDue({ total_visits: null }, 0)).toBe(false)
    expect(renewalDue({ total_visits: null }, 400)).toBe(false)
  })
})

describe('maintenanceConfig', () => {
  it("defaults to one visit a month with no end, back in Recalls after three months", () => {
    expect(maintenanceConfig(null)).toMatchObject({ visits_per_period: 1, frequency_value: 1, frequency_unit: 'month', total_visits: null, dischargeRecallMonths: 3, habitsArticleIds: [], habitsOnStart: true, habitsOnDischarge: false })
  })
  it("reads the clinic's own", () => {
    const c = maintenanceConfig({ maintenance_visits_per_period: 1, maintenance_frequency_value: 3, maintenance_frequency_unit: 'week', maintenance_total_visits: 8, maintenance_discharge_recall_months: 6 })
    expect(maintenancePreset(c)).toEqual({ visits_per_period: 1, frequency_value: 3, frequency_unit: 'week', total_visits: 8 })
    expect(c.dischargeRecallMonths).toBe(6)
  })
})

describe('previousCadence', () => {
  it("puts back the patient's cadence at the length chosen", () => {
    expect(previousCadence({ frequency_value: 1, frequency_unit: 'week', visits_per_period: 2 }, null)).toEqual({ frequency_value: 1, frequency_unit: 'week', visits_per_period: 2, total_visits: null })
    expect(previousCadence({ frequency_value: 2, frequency_unit: 'week', visits_per_period: null }, 6)).toEqual({ frequency_value: 2, frequency_unit: 'week', visits_per_period: 1, total_visits: 6 })
  })
})

describe('dischargeRecallDate', () => {
  it('is months from today, clamped to the end of a shorter month', () => {
    expect(dischargeRecallDate(3, new Date(2026, 10, 5))).toEqual(new Date(2027, 1, 5))
    expect(dischargeRecallDate(3, new Date(2026, 10, 30))).toEqual(new Date(2027, 1, 28))
    expect(dischargeRecallDate(1, new Date(2026, 0, 31))).toEqual(new Date(2026, 1, 28))
  })
})

describe('openEndedPlanLabel', () => {
  const now = new Date(2026, 10, 5)
  it('counts the visit and says since when', () => {
    expect(openEndedPlanLabel(7, '2026-03-02', es, now)).toBe('visita 7 de mantenimiento, desde marzo')
    expect(openEndedPlanLabel(7, '2026-03-02', en, now)).toBe('maintenance visit 7, since March')
    expect(openEndedPlanLabel(0, '2026-03-02', es, now)).toBe('mantenimiento desde marzo')
  })
  it('names the year when it is not this one', () => {
    expect(openEndedPlanLabel(14, '2025-09-15', es, now)).toBe('visita 14 de mantenimiento, desde septiembre de 2025')
  })
})

describe('planVisitsToBook', () => {
  it('is what is left of a plan, or the next six of one with no end', () => {
    expect(planVisitsToBook({ total_visits: 12 }, 4, 3)).toBe(5)
    expect(planVisitsToBook({ total_visits: 12 }, 10, 3)).toBe(0)
    expect(planVisitsToBook({ total_visits: null }, 30, 2)).toBe(4)
    expect(planVisitsToBook({ total_visits: null }, 30, 8)).toBe(0)
  })
})
