import { describe, expect, it } from 'vitest'
import { carePlanTemplateSummary, readCarePlanTemplate, sortCarePlanTemplates } from '../../utils/carePlanTemplates'

const es = (_e: string, s: string) => s

describe('readCarePlanTemplate', () => {
  it('reads a set course with phases and re-exams', () => {
    const tpl = readCarePlanTemplate({
      id: 'a',
      name: 'Fase inicial',
      visits_per_period: 2,
      frequency_value: 1,
      frequency_unit: 'week',
      total_visits: 12,
      next_phases: [{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: 6 }],
      visit_markers: [{ at: 12, every: 12, appointment_type_id: null, label: 'Revisión' }],
      payment_kind: 'bono',
      is_maintenance: false,
      sort_order: 2,
    })
    expect(tpl).toMatchObject({ name: 'Fase inicial', visits_per_period: 2, total_visits: 12, payment_kind: 'bono', is_maintenance: false, sort_order: 2 })
    expect(tpl.next_phases).toHaveLength(1)
    expect(tpl.visit_markers).toHaveLength(1)
  })

  it('drops queued phases from a plan with no end, and anything out of range', () => {
    const tpl = readCarePlanTemplate({
      id: 'b',
      name: 'Mantenimiento',
      visits_per_period: 99,
      frequency_value: 0,
      frequency_unit: 'year',
      total_visits: null,
      next_phases: [{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: 4 }],
      payment_kind: 'cash',
      is_maintenance: true,
    })
    expect(tpl).toMatchObject({ visits_per_period: 7, frequency_value: 1, frequency_unit: 'week', total_visits: null, next_phases: [], payment_kind: 'per_visit', is_maintenance: true })
  })
})

describe('carePlanTemplateSummary', () => {
  it('lists every phase in order', () => {
    const s = carePlanTemplateSummary(
      { visits_per_period: 2, frequency_value: 1, frequency_unit: 'week', total_visits: 12, next_phases: [{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: null }] },
      es,
    )
    expect(s.split(' → ')).toHaveLength(2)
    expect(s).toContain('12 visitas')
    expect(s).toContain('sin fin')
  })
})

describe('sortCarePlanTemplates', () => {
  it('orders by sort_order, then name', () => {
    const base = { visits_per_period: 1, frequency_value: 1, frequency_unit: 'week' as const, total_visits: 4, next_phases: [], visit_markers: [], payment_kind: 'per_visit' as const, is_maintenance: false }
    const list = sortCarePlanTemplates([
      { ...base, id: '1', name: 'Mantenimiento', sort_order: 1 },
      { ...base, id: '2', name: 'Correctivo', sort_order: 0 },
      { ...base, id: '3', name: 'Agudo', sort_order: 0 },
    ])
    expect(list.map((x) => x.name)).toEqual(['Agudo', 'Correctivo', 'Mantenimiento'])
  })
})
