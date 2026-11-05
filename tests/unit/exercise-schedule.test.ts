import { describe, it, expect } from 'vitest'
import { cleanSteps, copySteps, fromDraftSteps, newScheduleStepId, nextDraftStep, readSteps, scheduleProgress, scheduleStepTitle, toDraftSteps, type ScheduleStep } from '../../utils/exerciseSchedule'

const t = (en: string, _es: string) => en
const E1 = '11111111-1111-4111-8111-111111111111'
const E2 = '22222222-2222-4222-8222-222222222222'
const item = (exercise_id: string, over: Partial<ScheduleStep['items'][number]> = {}) => ({ exercise_id, sets: 2, reps: '10', frequency: 'Daily', notes: null, progressive: false, ...over })
const step = (from_visit: number, over: Partial<ScheduleStep> = {}): ScheduleStep => ({ id: `id-${from_visit}`, from_visit, label: null, keep_previous: false, items: [item(E1)], ...over })

describe('exercise schedules', () => {
  it('sorts steps by visit and tidies them for saving', () => {
    const r = cleanSteps([step(6, { label: '  Week 2 ' }), step(1, { items: [item(E1, { progressive: true }), item('')] })])
    if (!('steps' in r)) throw new Error('expected steps')
    expect(r.steps.map((s) => s.from_visit)).toEqual([1, 6])
    expect(r.steps[1].label).toBe('Week 2')
    // An empty row is dropped; a progressive dose loses its numbers.
    expect(r.steps[0].items).toEqual([{ exercise_id: E1, sets: null, reps: null, frequency: 'Daily', notes: null, progressive: true }])
  })

  it('says which step is wrong, numbered as the editor shows them', () => {
    expect(cleanSteps([])).toEqual({ problem: { kind: 'none' } })
    expect(cleanSteps([step(1), step(0)])).toEqual({ problem: { kind: 'visit', step: 2 } })
    expect(cleanSteps([step(Number.NaN)])).toEqual({ problem: { kind: 'visit', step: 1 } })
    expect(cleanSteps([step(1, { items: [item('')] })])).toEqual({ problem: { kind: 'empty', step: 1 } })
    expect(cleanSteps([step(1, { items: [item(E1), item(E1)] })])).toEqual({ problem: { kind: 'repeated', step: 1 } })
    expect(cleanSteps([step(1, { items: [item(E1, { sets: 1.5 })] })])).toEqual({ problem: { kind: 'sets', step: 1 } })
  })

  it('turns typed drafts back into numbers, and mistakes into refusals', () => {
    const drafts = toDraftSteps([step(3, { items: [item(E1, { sets: null })] })])
    expect(drafts[0].from_visit).toBe('3')
    expect(drafts[0].items[0].sets).toBe('')
    drafts[0].from_visit = 'x'
    expect(cleanSteps(fromDraftSteps(drafts))).toEqual({ problem: { kind: 'visit', step: 1 } })
  })

  it('suggests the next step a few visits after the last', () => {
    expect(nextDraftStep([]).from_visit).toBe('1')
    expect(nextDraftStep(toDraftSteps([step(1), step(6)])).from_visit).toBe('10')
  })

  it('copies a template with fresh ids and nothing given', () => {
    const copy = copySteps([step(1, { applied_at: '2026-11-05T10:00:00Z' })])
    expect(copy[0].id).not.toBe('id-1')
    expect(copy[0].applied_at).toBeNull()
  })

  it('reads stored steps defensively', () => {
    expect(readSteps(null)).toEqual([])
    const [s] = readSteps([{ id: 'a', from_visit: 2, items: [{ exercise_id: E2, sets: 3 }, { nope: true }], applied_at: '2026-11-05' }])
    expect(s).toMatchObject({ from_visit: 2, keep_previous: false, label: null, applied_at: '2026-11-05' })
    expect(s.items).toEqual([{ exercise_id: E2, sets: 3, reps: null, frequency: null, notes: null, progressive: false }])
  })

  it('says where a patient stands', () => {
    const steps = [step(1, { applied_at: 'x' }), step(6), step(12)]
    expect(scheduleProgress(steps, 4)).toMatchObject({ current: { from_visit: 1 }, next: { from_visit: 6 }, visitsToNext: 2 })
    expect(scheduleProgress([step(1, { applied_at: 'x' })], 9)).toMatchObject({ next: null, visitsToNext: null })
    expect(scheduleStepTitle({ from_visit: 6, label: 'Week 2' }, t)).toBe('From visit 6 · Week 2')
  })
})

describe('step ids', () => {
  it('are uuids the database accepts, even without crypto.randomUUID', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    expect(newScheduleStepId()).toMatch(uuid)
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const id = newScheduleStepId()
      expect(id).toMatch(uuid)
      expect(id[14]).toBe('4')
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})
