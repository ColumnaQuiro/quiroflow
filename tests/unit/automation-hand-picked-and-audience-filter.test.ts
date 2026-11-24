import { describe, it, expect } from 'vitest'
import { MAX_PICKED_PATIENTS, asPatientIds, audienceFilterMatches, needsAudienceMembership } from '../../utils/automationAudience'
import { FILTER_KEYS, FILTERS, defaultFilterValue, filtersInUse } from '../../utils/automationCatalog'
import { emptyLookup, filtersText } from '../../utils/automationDescribe'
import { findProblems } from '../../utils/automationTree'
import { namedRecipients } from '../../server/utils/audienceMembers'
import { ruleFiltersMatch } from '../../server/utils/evaluateAutomationFilters'

// Two ways of saying who an automation reaches, beside the saved list or
// segment a group send could already be aimed at:
//   * a one-off send to patients chosen one by one (segment.patient_ids), and
//   * an event-triggered automation limited to whoever is (or is not) in a
//     list or segment when it fires (filters.in_audiences / not_in_audiences).

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const LIST = uuid(1001)
const SEGMENT = uuid(1002)
const OTHER = uuid(1003)
const t = (en: string) => en

describe('patients chosen one by one', () => {
  it('keeps ids only, each once, lower-cased, in the order chosen', () => {
    expect(asPatientIds([uuid(2), 'drop table', uuid(1), uuid(2).toUpperCase(), 7, null])).toEqual([uuid(2), uuid(1)])
    expect(asPatientIds('not a list')).toEqual([])
    expect(asPatientIds(undefined)).toEqual([])
  })

  it('stops at the most a send can name', () => {
    const many = Array.from({ length: MAX_PICKED_PATIENTS + 5 }, (_, i) => uuid(i + 1))
    expect(asPatientIds(many)).toHaveLength(MAX_PICKED_PATIENTS)
  })

  it('counts as saying who a group goes to, so it is not "every patient"', () => {
    const base = { name: 'x', filters: {}, is_marketing: true, dry_run: false, entry_mode: 'once_ever' as const, exit_on: [], quiet_hours: null }
    const step = [{ id: 's', action_type: 'email', config: { subject: 'Hola', body: '<p>Hola</p>' }, parent_id: null, branch: null, position: 0 }]
    const group = (segment: Record<string, unknown>) => findProblems({ ...base, trigger_event: 'segment', segment: { schedule: { kind: 'once' }, filters: {}, ...segment } } as never, step, null)
    const everyone = (ps: { message: [string, string] }[]) => ps.some((p) => p.message[0].includes('otherwise it is every patient'))
    expect(everyone(group({ patient_ids: [] }))).toBe(true)
    expect(everyone(group({ patient_ids: ['not-an-id'] }))).toBe(true)
    expect(everyone(group({ patient_ids: [uuid(1)] }))).toBe(false)
  })
})

describe('who a group send names', () => {
  // audience_members, as the service role sees it: list LIST holds 1 and 2,
  // segment SEGMENT holds 2 and 3.
  const members: Record<string, string[]> = { [`list:${LIST}`]: [uuid(1), uuid(2)], [`segment:${SEGMENT}`]: [uuid(2), uuid(3)] }
  const service = {
    rpc: (_fn: string, args: { p_kind: string; p_id: string }) => ({
      range: async () => ({ data: (members[`${args.p_kind}:${args.p_id}`] ?? []).map((patient_id) => ({ patient_id })), error: null }),
    }),
  }

  it('is nobody in particular when it names neither, so the filters decide', async () => {
    expect(await namedRecipients(service, { filters: {} } as never)).toBeNull()
    expect(await namedRecipients(service, null)).toBeNull()
  })

  it('is the chosen patients, less anyone in an excluded audience', async () => {
    const named = await namedRecipients(service, { patient_ids: [uuid(1), uuid(2), uuid(4)], exclude: [{ kind: 'segment', id: SEGMENT }] })
    expect([...named!].sort()).toEqual([uuid(1), uuid(4)])
  })

  it('is the list when there is one, whatever selection is left over', async () => {
    const named = await namedRecipients(service, { audience: { kind: 'list', id: LIST }, patient_ids: [uuid(9)] })
    expect([...named!].sort()).toEqual([uuid(1), uuid(2)])
  })
})

describe('"in a list or segment" on a trigger', () => {
  it('is any-of for "in", none-of for "not in", and asks nothing when empty', () => {
    const inList = new Set([`list:${LIST}`])
    expect(audienceFilterMatches({ in_audiences: [{ kind: 'list', id: LIST }, { kind: 'segment', id: SEGMENT }] }, inList)).toBe(true)
    expect(audienceFilterMatches({ in_audiences: [{ kind: 'segment', id: SEGMENT }] }, inList)).toBe(false)
    expect(audienceFilterMatches({ not_in_audiences: [{ kind: 'list', id: LIST }] }, inList)).toBe(false)
    expect(audienceFilterMatches({ not_in_audiences: [{ kind: 'list', id: OTHER }] }, inList)).toBe(true)
    expect(audienceFilterMatches({ in_audiences: [] }, new Set())).toBe(true)
    expect(needsAudienceMembership({ in_audiences: [] })).toBe(false)
    expect(needsAudienceMembership({ not_in_audiences: [{ kind: 'list', id: LIST }] })).toBe(true)
  })

  it('is offered under "Only if", not on a group send, and removes both its keys', () => {
    const def = FILTERS.find((f) => f.key === 'audience')!
    expect(def.segment).toBeFalsy()
    expect(def.appointment).toBeFalsy()
    expect(filtersInUse(defaultFilterValue('audience'))).toContain('audience')
    expect(filtersInUse({ not_in_audiences: [] })).toContain('audience')
    expect(FILTER_KEYS.audience.sort()).toEqual(['in_audiences', 'not_in_audiences'])
  })

  it('is described by the names of the lists and segments', () => {
    const lookup = { ...emptyLookup(), audiences: [{ kind: 'list' as const, id: LIST, name: 'Corporate' }, { kind: 'segment' as const, id: SEGMENT, name: 'Lapsed' }] }
    expect(filtersText(t as never, { in_audiences: [{ kind: 'list', id: LIST }], not_in_audiences: [{ kind: 'segment', id: SEGMENT }] }, lookup)).toBe('In Corporate · Not in Lapsed')
    expect(filtersText(t as never, { in_audiences: [{ kind: 'list', id: OTHER }] }, emptyLookup())).toBe('In a list or segment')
  })

  it('cannot be switched on added and left empty', () => {
    const base = { name: 'x', is_marketing: false, dry_run: false, entry_mode: 'every_time' as const, exit_on: [], quiet_hours: null, segment: null }
    const step = [{ id: 's', action_type: 'email', config: { subject: 'Hola', body: '<p>Hola</p>' }, parent_id: null, branch: null, position: 0 }]
    const problems = (filters: Record<string, unknown>) => findProblems({ ...base, trigger_event: 'appointment.completed', filters } as never, step, null)
    const asks = (ps: { message: [string, string] }[]) => ps.some((p) => p.message[0].includes('"In a list or segment"'))
    expect(asks(problems({ in_audiences: [] }))).toBe(true)
    expect(asks(problems({ in_audiences: [{ kind: 'list', id: LIST }] }))).toBe(false)
    expect(asks(problems({}))).toBe(false)
  })

  // The membership read the engine makes for one patient when the trigger fires.
  function fakeDb(rows: { lists: string[]; segments: string[] }, failing = false) {
    const chain = (data: unknown[]) => {
      const q: any = { select: () => q, eq: () => q, in: () => q, is: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: failing ? null : data, error: failing ? { message: 'boom' } : null }).then(ok) }
      return q
    }
    return {
      from: (table: string) =>
        table === 'patient_list_members' ? chain(rows.lists.map((list_id) => ({ list_id }))) : chain(rows.segments.map((segment_id) => ({ segment_id }))),
    }
  }

  it('lets the patient through only when they are in the list, and not in the excluded segment', async () => {
    const patient = uuid(1)
    const f = { in_audiences: [{ kind: 'list' as const, id: LIST }], not_in_audiences: [{ kind: 'segment' as const, id: SEGMENT }] }
    expect(await ruleFiltersMatch(fakeDb({ lists: [LIST], segments: [] }), patient, f)).toBe(true)
    expect(await ruleFiltersMatch(fakeDb({ lists: [], segments: [] }), patient, f)).toBe(false)
    expect(await ruleFiltersMatch(fakeDb({ lists: [LIST], segments: [SEGMENT] }), patient, f)).toBe(false)
  })

  it('does not fire when membership cannot be read, rather than reach someone it should not', async () => {
    const f = { not_in_audiences: [{ kind: 'list' as const, id: LIST }] }
    expect(await ruleFiltersMatch(fakeDb({ lists: [], segments: [] }, true), uuid(1), f)).toBe(false)
  })
})
