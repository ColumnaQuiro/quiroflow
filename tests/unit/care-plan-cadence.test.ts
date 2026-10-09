import { describe, expect, it } from 'vitest'
import { carePlanCadenceLabel, carePlanGapDays } from '../../utils/carePlanCadence'

const es = (_en: string, es: string) => es
const en = (en: string) => en

describe("a care plan's cadence", () => {
  it('says interval and visits the way people do', () => {
    expect(carePlanCadenceLabel({ frequency_value: 1, frequency_unit: 'week' }, es)).toBe('semanal')
    expect(carePlanCadenceLabel({ frequency_value: 3, frequency_unit: 'week' }, es)).toBe('cada 3 semanas')
    expect(carePlanCadenceLabel({ frequency_value: 1, frequency_unit: 'week', visits_per_period: 2 }, es)).toBe('2 veces por semana')
    expect(carePlanCadenceLabel({ frequency_value: 2, frequency_unit: 'week', visits_per_period: 3 }, es)).toBe('3 veces cada 2 semanas')
    expect(carePlanCadenceLabel({ frequency_value: 1, frequency_unit: 'month', visits_per_period: 2 }, en)).toBe('2× a month')
    expect(carePlanCadenceLabel({ frequency_value: 1, frequency_unit: 'month' }, en)).toBe('monthly')
  })

  it('spaces visits by the period over its visits, rounded up (as Care Plan Alerts)', () => {
    expect(carePlanGapDays({ frequency_value: 1, frequency_unit: 'week', visits_per_period: 2 })).toBe(4)
    expect(carePlanGapDays({ frequency_value: 2, frequency_unit: 'week' })).toBe(14)
    expect(carePlanGapDays({ frequency_value: 1, frequency_unit: 'month', visits_per_period: 2 })).toBe(15)
  })
})
