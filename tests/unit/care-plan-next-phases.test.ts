import { describe, expect, it } from 'vitest'
import { cleanNextPhases, MAX_NEXT_PHASES, nextPhaseLabel, readNextPhases } from '../../utils/carePlanPhases'
import { renewalDue } from '../../utils/planRenewal'

const es = (_en: string, es: string) => es
const weekly = { visits_per_period: 1, frequency_value: 1, frequency_unit: 'week' as const, total_visits: 4 }

describe("a care plan's next phases", () => {
  it('keeps numbers in range, as the check constraint does', () => {
    expect(cleanNextPhases([{ visits_per_period: 9, frequency_value: 0, frequency_unit: 'month', total_visits: 500 }])).toEqual([
      { visits_per_period: 7, frequency_value: 1, frequency_unit: 'month', total_visits: 200 },
    ])
    expect(cleanNextPhases([{ visits_per_period: 1.6, frequency_value: 2, frequency_unit: 'fortnight' as never, total_visits: 3 }])).toEqual([
      { visits_per_period: 2, frequency_value: 2, frequency_unit: 'week', total_visits: 3 },
    ])
  })

  it('drops whatever comes after a phase with no end, which would never start', () => {
    expect(cleanNextPhases([weekly, { ...weekly, total_visits: null }, weekly])).toEqual([weekly, { ...weekly, total_visits: null }])
  })

  it('holds at most six', () => {
    expect(cleanNextPhases(Array.from({ length: 9 }, () => weekly))).toHaveLength(MAX_NEXT_PHASES)
  })

  it('reads nothing from a column that is not a list', () => {
    expect(readNextPhases(null)).toEqual([])
    expect(readNextPhases({})).toEqual([])
    expect(readNextPhases([weekly])).toEqual([weekly])
  })

  it('says each phase as cadence and length', () => {
    expect(nextPhaseLabel(weekly, es)).toBe('semanal · 4 visitas')
    expect(nextPhaseLabel({ visits_per_period: 1, frequency_value: 1, frequency_unit: 'month', total_visits: null }, es)).toBe('mensual · sin fin')
    expect(nextPhaseLabel({ ...weekly, visits_per_period: 2, total_visits: 1 }, es)).toBe('2 veces por semana · 1 visita')
  })

  it('holds back the end-of-plan review while a phase is queued', () => {
    expect(renewalDue({ total_visits: 8 }, 7)).toBe(true)
    expect(renewalDue({ total_visits: 8, next_phases: [weekly] }, 7)).toBe(false)
    expect(renewalDue({ total_visits: 8, next_phases: [] }, 7)).toBe(true)
  })
})
