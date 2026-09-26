import { describe, expect, it } from 'vitest'
import { findProblems, normalizePositions, structuralErrors, successorInNewTree, type DraftRule, type DraftStep } from '../../utils/automationTree'
import { layoutTree } from '../../utils/automationLayout'
import { filtersInUse } from '../../utils/automationCatalog'

// The pure halves of the Automations builder: what makes a tree unsaveable,
// what is missing before it can run, where someone on a removed step goes,
// and where the canvas puts each node.

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const step = (action_type: string, position: number, parent: DraftStep | null = null, branch: string | null = null, config: Record<string, any> = {}): DraftStep => ({
  id: id(),
  action_type,
  config,
  parent_id: parent?.id ?? null,
  branch,
  position,
})
const rule = (extra: Partial<DraftRule> = {}): DraftRule => ({
  name: 'Regla',
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

describe('structural errors', () => {
  it('accepts a tree with two paths', () => {
    const b = step('branch', 0)
    const steps = [b, step('tag', 0, b, 'yes', { tag: 'x' }), step('delay', 0, b, 'no', { delay_minutes: 60 })]
    expect(structuralErrors(steps, 'appointment.completed')).toEqual([])
  })

  it('refuses a chain under a step with no such outlet, and a parent from elsewhere', () => {
    const d = step('delay', 0)
    const orphan: DraftStep = { ...step('tag', 0), parent_id: id(), branch: 'yes' }
    const wrongOutlet = step('tag', 0, d, 'yes')
    const errors = structuralErrors([d, orphan, wrongOutlet], 'appointment.completed')
    expect(errors.some((e) => e.includes('not in this automation'))).toBe(true)
    expect(errors.some((e) => e.includes('does not have'))).toBe(true)
  })

  it('refuses a step after a fork in its own chain, which the engine could never reach', () => {
    const b = step('branch', 0)
    expect(structuralErrors([b, step('tag', 1)], 'appointment.completed').join(' ')).toContain('Nothing can follow')
  })

  it('refuses lead steps outside a lead automation', () => {
    expect(structuralErrors([step('lead_stage', 0, null, null, { stage: 'contacted' })], 'appointment.completed').join(' ')).toContain('lead automation')
    expect(structuralErrors([step('lead_stage', 0, null, null, { stage: 'contacted' })], 'lead.created')).toEqual([])
  })
})

describe('what is missing before it can run', () => {
  it('asks for a limit on a wait, and for every template variable', () => {
    const wait = step('wait_until', 0, null, null, { event: 'appointment.booked' })
    const wa = step('whatsapp_template', 1, null, null, { template_name: 'hola', template_language: 'es', variables: [] })
    const problems = findProblems(rule(), [wa, wait], [{ name: 'hola', language: 'es', status: 'APPROVED', variableCount: 1, urlButtonCount: 0, mediaHeaderFormat: null }])
    const text = problems.map((p) => p.message[0]).join(' | ')
    expect(text).toContain('no time limit')
    expect(text).toContain('{{1}}')
  })

  it('says a template is not approved', () => {
    const wa = step('whatsapp_template', 0, null, null, { template_name: 'promo', template_language: 'es', variables: [] })
    const problems = findProblems(rule(), [wa], [{ name: 'promo', language: 'es', status: 'PENDING', variableCount: 0, urlButtonCount: 0, mediaHeaderFormat: null }])
    expect(problems.map((p) => p.message[1]).join(' ')).toContain('pendiente de aprobación')
  })

  it('skips the template checks when the templates cannot be read', () => {
    const wa = step('whatsapp_template', 0, null, null, { template_name: 'hola', variables: [{ source: 'first_name' }] })
    expect(findProblems(rule(), [wa], null)).toEqual([])
  })
})

describe('moving people on from a removed step', () => {
  it('hands over to what followed a deleted step', () => {
    const a = step('whatsapp_template', 0)
    const d = step('delay', 1)
    const c = step('tag', 2)
    const next = normalizePositions([a, c])
    expect(successorInNewTree(d.id, [a, d, c], next)?.id).toBe(c.id)
  })

  it('hands over to a replacement put where the step was', () => {
    const a = step('whatsapp_template', 0)
    const d = step('delay', 1)
    const c = step('tag', 2)
    const replacement = step('delay', 1)
    expect(successorInNewTree(d.id, [a, d, c], normalizePositions([a, replacement, { ...c, position: 2 }]))?.id).toBe(replacement.id)
  })

  it('climbs out of a removed path to what followed the fork', () => {
    const w = step('wait_until', 0)
    const inside = step('tag', 0, w, 'met')
    expect(successorInNewTree(inside.id, [w, inside], [])).toBeNull()
  })
})

describe('canvas layout', () => {
  it('centres a chain and puts two paths side by side', () => {
    const b = step('branch', 0)
    const yes = step('tag', 0, b, 'yes')
    const no = step('delay', 0, b, 'no')
    const layout = layoutTree([b, yes, no])
    const node = (x: string) => layout.nodes.find((nd) => nd.id === x)!
    const trigger = node('trigger')
    expect(node(b.id).x).toBe(trigger.x)
    expect(node(yes.id).x).toBeLessThan(node(no.id).x)
    expect(node(yes.id).y).toBe(node(no.id).y)
    // A "+" above each step, before each end, and none after the fork in its own chain.
    expect(layout.inserts.filter((p) => p.parentId === null).map((p) => p.index)).toEqual([0])
    expect(layout.nodes.filter((nd) => nd.kind === 'end')).toHaveLength(2)
    expect(layout.labels.map((l) => l.branch)).toEqual(['yes', 'no'])
  })
})

describe('filters in use', () => {
  it('keeps a just-added, still empty tag filter on screen', () => {
    expect(filtersInUse({ tag_contains: '' })).toEqual(['tag_contains'])
    expect(filtersInUse({ appointment_type_id: 'x', hours_before: 24 })).toEqual(['appointment_types'])
  })
})
