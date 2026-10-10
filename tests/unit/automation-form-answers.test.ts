import { describe, expect, it } from 'vitest'
import { evaluateBranch, factKey } from '../../utils/automationConditions'
import { findProblems, formsSentBefore, stepsBefore, type DraftRule, type DraftStep } from '../../utils/automationTree'
import { conditionText } from '../../utils/automationDescribe'
import { emptyLookup } from '../../utils/automationDescribe'

// A branch on an answer the patient gave on a form the automation sent: the
// revision form's "would you recommend us?", 8 or more -> ask for a review.

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const FORM = '11111111-1111-4111-8111-111111111111'
const OTHER_FORM = '22222222-2222-4222-8222-222222222222'
const QUESTION = 'q-recommend'

const step = (action_type: string, position: number, parent: DraftStep | null = null, branch: string | null = null, config: Record<string, any> = {}): DraftStep => ({
  id: id(),
  action_type,
  config,
  parent_id: parent?.id ?? null,
  branch,
  position,
})
const rule = (extra: Partial<DraftRule> = {}): DraftRule => ({
  name: 'Revisión',
  trigger_event: 'appointment.completed',
  filters: {},
  is_marketing: false,
  dry_run: false,
  entry_mode: 'every_time',
  exit_on: [],
  quiet_hours: null,
  segment: null,
  ...extra,
})
const recommends = (op: 'gte' | 'lte' | 'is', value: unknown) => ({ field: 'doc_answer', op, value, doc_template_id: FORM, doc_field_id: QUESTION }) as const

describe('branching on a form answer', () => {
  it('reads each answer under its own key, so two answers in one branch do not collide', () => {
    const a = factKey({ field: 'doc_answer', doc_template_id: FORM, doc_field_id: 'q1' })
    const b = factKey({ field: 'doc_answer', doc_template_id: FORM, doc_field_id: 'q2' })
    expect(a).not.toEqual(b)
    expect(factKey({ field: 'tags' })).toBe('tags')
  })

  it('sends an 8, 9 or 10 down "yes" and a 7 down "no"', () => {
    const config = { conditions: [recommends('gte', 8)] }
    const key = factKey(recommends('gte', 8))
    expect(evaluateBranch(config, { [key]: 8 })).toBe(true)
    expect(evaluateBranch(config, { [key]: 10 })).toBe(true)
    expect(evaluateBranch(config, { [key]: 7 })).toBe(false)
    expect(evaluateBranch(config, { [key]: 0 })).toBe(false)
  })

  it('sends someone who has not answered down "no"', () => {
    expect(evaluateBranch({ conditions: [recommends('gte', 8)] }, {})).toBe(false)
    expect(evaluateBranch({ conditions: [recommends('lte', 6)] }, {})).toBe(false)
  })

  it('compares a choice answer as text', () => {
    const c = { field: 'doc_answer', op: 'is', value: 'Mucho mejor', doc_template_id: FORM, doc_field_id: 'q-how' } as const
    expect(evaluateBranch({ conditions: [c] }, { [factKey(c)]: 'mucho mejor' })).toBe(true)
    const many = { ...c, op: 'contains', value: 'espalda' } as const
    expect(evaluateBranch({ conditions: [many] }, { [factKey(many)]: ['Cuello', 'Espalda baja'] })).toBe(true)
  })
})

describe('what the builder checks', () => {
  it('needs a form and a question', () => {
    const branch = step('branch', 0, null, null, { conditions: [{ field: 'doc_answer', op: 'gte', value: 8 }] })
    const problems = findProblems(rule(), [branch], null)
    expect(problems.some((p) => p.message[0].includes('which form and question'))).toBe(true)
  })

  it('accepts a complete answer condition', () => {
    const branch = step('branch', 0, null, null, { conditions: [recommends('gte', 8)] })
    expect(findProblems(rule(), [branch], null)).toEqual([])
  })

  it('accepts waiting for a form', () => {
    const wait = step('wait_until', 0, null, null, { event: 'doc.completed', doc_template_id: FORM, timeout_minutes: 7 * 1440 })
    expect(findProblems(rule(), [wait], null)).toEqual([])
  })

  it('does not offer form answers to a lead automation', () => {
    const branch = step('branch', 0, null, null, { conditions: [recommends('gte', 8)] })
    const problems = findProblems(rule({ trigger_event: 'lead.created' }), [branch], null)
    expect(problems.some((p) => p.message[0].includes('only apply to patients'))).toBe(true)
  })
})

describe('the forms sent before a step', () => {
  // send form -> wait until completed -> [met] branch on the answer
  const send = step('whatsapp_template', 0, null, null, { template_name: 'revision', doc_template_ids: [FORM] })
  const wait = step('wait_until', 1, null, null, { event: 'doc.completed', doc_template_id: FORM, timeout_minutes: 10080 })
  const branch = step('branch', 0, wait, 'met', { conditions: [recommends('gte', 8)] })
  const review = step('whatsapp_template', 0, branch, 'yes', { template_name: 'review' })
  const later = step('whatsapp_template', 2, null, null, { template_name: 'later', doc_template_ids: [OTHER_FORM] })
  const steps = [send, wait, branch, review, later]

  it('walks up through the wait the branch hangs from', () => {
    expect(stepsBefore(steps, branch.id).map((s) => s.id).sort()).toEqual([send.id, wait.id].sort())
  })

  it('offers the form the automation sent earlier, and not one it sends afterwards', () => {
    expect(formsSentBefore(steps, branch.id)).toEqual([FORM])
    expect(formsSentBefore(steps, review.id)).toEqual([FORM])
  })

  it('reads the question on the canvas rather than "Form answer"', () => {
    const lookup = { ...emptyLookup(), docTemplates: [{ id: FORM, title: 'Revisión', fields: [{ id: QUESTION, label: '¿Recomendarías este tratamiento?' }] }] }
    const es = (_en: string, es: string) => es
    expect(conditionText(es, recommends('gte', 8), lookup)).toBe('«¿Recomendarías este tratamiento?» al menos 8')
  })
})
