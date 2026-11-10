import { describe, it, expect } from 'vitest'
import { triggerTypeMatches } from '../../utils/automationTriggerMatch'
import { conditionHolds, evaluateBranch } from '../../utils/automationConditions'
import { triggerTitle, STEP_TYPES, TRIGGERS, conditionFieldDef } from '../../utils/automationCatalog'
import { filtersFromQuery, filtersToQuery, normalizeFilters } from '../../utils/patientFilters'

// Patient types (20261109181443): the trigger setting that says which type
// starts an automation, the branch condition on a patient's types -- several
// at once, so "is one of" must ask about every one -- and the Patients list
// filter that carries them in the URL.

const es = (_en: string, s: string) => s
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('patient type trigger', () => {
  it('takes any type until one is chosen, then only that one', () => {
    expect(triggerTypeMatches({}, A)).toBe(true)
    expect(triggerTypeMatches({ trigger_type_id: '' }, A)).toBe(true)
    expect(triggerTypeMatches({ trigger_type_id: A }, A)).toBe(true)
    expect(triggerTypeMatches({ trigger_type_id: A }, B)).toBe(false)
  })

  it('names the type it starts on', () => {
    expect(triggerTitle(es, 'patient.type_added', { trigger_type_id: A, trigger_type_name: 'Mayor de 65' })).toBe('Se pone el tipo «Mayor de 65»')
    expect(triggerTitle(es, 'patient.type_removed', { trigger_type_id: A, trigger_type_name: 'Mayor de 65' })).toBe('Se quita el tipo «Mayor de 65»')
  })

  it('is offered as a trigger, with its steps', () => {
    expect(TRIGGERS.some((x) => x.value === 'patient.type_added')).toBe(true)
    expect(TRIGGERS.some((x) => x.value === 'patient.type_removed')).toBe(true)
    expect(STEP_TYPES.map((s) => s.type)).toEqual(expect.arrayContaining(['patient_type', 'assign_exercises']))
    expect(conditionFieldDef('patient_type_ids')?.options).toBe('patient_types')
  })
})

describe('patient type condition', () => {
  it('"is one of" holds when any of their types is among the chosen', () => {
    expect(conditionHolds([A, B], 'in', [B])).toBe(true)
    expect(conditionHolds([A, B], 'in', [C])).toBe(false)
    expect(conditionHolds([], 'in', [A])).toBe(false)
  })

  it('"is none of" holds only when no type of theirs was chosen', () => {
    expect(conditionHolds([A, B], 'not_in', [C])).toBe(true)
    expect(conditionHolds([A, B], 'not_in', [A])).toBe(false)
    expect(conditionHolds([], 'not_in', [A])).toBe(true)
  })

  it('still compares a single value as before', () => {
    expect(conditionHolds(A, 'in', [A, B])).toBe(true)
    expect(conditionHolds(C, 'not_in', [A, B])).toBe(true)
    expect(conditionHolds(undefined, 'in', [A])).toBe(false)
  })

  it('routes a branch on it', () => {
    const config = { match: 'all' as const, conditions: [{ field: 'patient_type_ids', op: 'in' as const, value: [A] }] }
    expect(evaluateBranch(config, { patient_type_ids: [A] })).toBe(true)
    expect(evaluateBranch(config, { patient_type_ids: [B] })).toBe(false)
  })
})

describe('patient type filter', () => {
  it('keeps valid ids only, sorted and once each', () => {
    expect(normalizeFilters({ types: [B, A, A, 'nope'] })).toEqual({ types: [A, B] })
    expect(normalizeFilters({ types: [] })).toEqual({})
  })

  it('round-trips through the URL', () => {
    const q = filtersToQuery({ types: [A, B] })
    expect(q).toEqual({ types: `${A},${B}` })
    expect(filtersFromQuery(q)).toEqual({ types: [A, B] })
  })
})
