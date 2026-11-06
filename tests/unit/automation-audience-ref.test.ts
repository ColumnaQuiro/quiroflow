import { describe, it, expect } from 'vitest'
import { asAudienceRef, asAudienceRefs } from '../../utils/automationAudience'
import { findProblems } from '../../utils/automationTree'

// A saved audience as stored on a rule: a list or a segment, by id. Anything
// else is no audience at all, never a malformed one sent to the engine.

const id = '6f0c7d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f'

describe('saved audiences', () => {
  it('reads a list or a segment, and nothing else', () => {
    expect(asAudienceRef({ kind: 'list', id })).toEqual({ kind: 'list', id })
    expect(asAudienceRef({ kind: 'segment', id, extra: 1 })).toEqual({ kind: 'segment', id })
    expect(asAudienceRef({ kind: 'table', id })).toBeNull()
    expect(asAudienceRef({ kind: 'list', id: 'drop table' })).toBeNull()
    expect(asAudienceRef(null)).toBeNull()
  })

  it('keeps only the readable ones of a list, at most ten', () => {
    expect(asAudienceRefs([{ kind: 'list', id }, { kind: 'x', id }, 'nope'])).toEqual([{ kind: 'list', id }])
    expect(asAudienceRefs(Array.from({ length: 12 }, () => ({ kind: 'list', id })))).toHaveLength(10)
    expect(asAudienceRefs(undefined)).toEqual([])
  })

  it('lets a group send name a list instead of filters, and asks the entry trigger for one', () => {
    const base = { name: 'x', filters: {}, is_marketing: true, dry_run: false, entry_mode: 'once_ever' as const, exit_on: [], quiet_hours: null }
    const step = [{ id: 's', action_type: 'email', config: { subject: 'Hola', body: '<p>Hola</p>' }, parent_id: null, branch: null, position: 0 }]
    const group = (segment: Record<string, unknown>) => findProblems({ ...base, trigger_event: 'segment', segment: { schedule: { kind: 'once' }, ...segment } } as never, step, null)
    expect(group({ filters: {} }).some((p) => p.message[0].includes('list or segment'))).toBe(true)
    expect(group({ filters: {}, audience: { kind: 'list', id } }).some((p) => p.message[0].includes('list or segment'))).toBe(false)
    const entered = findProblems({ ...base, trigger_event: 'audience.entered', segment: null } as never, step, null)
    expect(entered.some((p) => p.message[0].startsWith('Choose the list or segment'))).toBe(true)
  })
})
