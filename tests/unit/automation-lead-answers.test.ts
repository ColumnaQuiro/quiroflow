import { describe, expect, it } from 'vitest'
import { conditionHolds, evaluateBranch, factKey } from '../../utils/automationConditions'
import { answerKey } from '../../utils/automationFields'
import { findProblems, type DraftRule, type DraftStep } from '../../utils/automationTree'
import { conditionText, emptyLookup } from '../../utils/automationDescribe'

// A branch on what a lead answered on the ad's form: "En una escala del 1 al
// 10, ¿qué tan pronto quieres ser atendido?" -- 7 or more gets the offer
// straight away, the rest are asked first. The answers are free text, and
// real ones include "Dentro de 2 semanas".

const URGENCY = answerKey('En una escala del 1 al 10, ¿qué tan pronto quieres ser atendido?')
const urgent = { field: 'lead_answer', op: 'gte', value: 7, answer_key: URGENCY } as const
const facts = (answer: string | undefined) => ({ [factKey(urgent)]: answer })

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const step = (config: Record<string, any>): DraftStep => ({ id: id(), action_type: 'branch', config, parent_id: null, branch: null, position: 0 })
const rule = (trigger_event = 'lead.created'): DraftRule => ({
  name: 'Leads',
  trigger_event,
  filters: {},
  is_marketing: false,
  dry_run: false,
  entry_mode: 'once_ever',
  exit_on: [],
  quiet_hours: null,
  segment: null,
})

describe('branching on a lead form answer', () => {
  it('keys each question apart, so two answers in one branch do not collide', () => {
    expect(factKey(urgent)).toBe(`lead_answer:${URGENCY}`)
    expect(factKey({ field: 'lead_answer', answer_key: 'answer_otra' })).not.toBe(factKey(urgent))
  })

  it('sends 7 to 10 down "yes" and 1 to 6 down "no"', () => {
    for (const a of ['7', '8', '10', ' 9 ']) expect(evaluateBranch({ conditions: [urgent] }, facts(a))).toBe(true)
    for (const a of ['1', '6']) expect(evaluateBranch({ conditions: [urgent] }, facts(a))).toBe(false)
  })

  it('reads the number a written answer starts with', () => {
    expect(conditionHolds('8/10', 'gte', 7)).toBe(true)
    expect(conditionHolds('9 - lo antes posible', 'gte', 7)).toBe(true)
    expect(conditionHolds('7,5', 'gte', 7)).toBe(true)
  })

  it('sends an answer that is not a number, a blank one or none down "no"', () => {
    for (const a of ['Dentro de 2 semanas', 'yo solo quiero saber', '', undefined]) {
      expect(evaluateBranch({ conditions: [urgent] }, facts(a))).toBe(false)
    }
  })

  it('still compares plain numbers as before', () => {
    expect(conditionHolds(8, 'gte', 8)).toBe(true)
    expect(conditionHolds(7, 'gte', 8)).toBe(false)
  })
})

describe('what the builder checks', () => {
  it('needs a question', () => {
    const problems = findProblems(rule(), [step({ conditions: [{ field: 'lead_answer', op: 'gte', value: 7 }] })], null)
    expect(problems.some((p) => p.message[0].includes('which question'))).toBe(true)
  })

  it('accepts a complete condition on a lead automation', () => {
    expect(findProblems(rule(), [step({ conditions: [urgent] })], null)).toEqual([])
  })

  it('does not offer it to a patient automation', () => {
    const problems = findProblems(rule('appointment.completed'), [step({ conditions: [urgent] })], null)
    expect(problems.some((p) => p.message[0].includes('only applies to leads'))).toBe(true)
  })

  it('reads the question on the canvas', () => {
    const text = conditionText((en) => en, urgent, emptyLookup())
    expect(text).toContain('en una escala del 1 al 10')
    expect(text).toContain('at least 7')
  })
})
