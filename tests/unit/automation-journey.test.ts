import { describe, expect, it } from 'vitest'
import { buildJourney, defaultJourneyStep, type JourneyEvent, type JourneyMessage, type JourneyRun, type JourneyStep } from '../../utils/automationJourney'

// wa1 -> wait -> fork(yes: tag | no: wa2)
const STEPS: JourneyStep[] = [
  { id: 'wa1', parent_id: null, branch: null, position: 0, action_type: 'whatsapp_template' },
  { id: 'wait', parent_id: null, branch: null, position: 1, action_type: 'delay' },
  { id: 'fork', parent_id: null, branch: null, position: 2, action_type: 'branch' },
  { id: 'tag', parent_id: 'fork', branch: 'yes', position: 0, action_type: 'tag' },
  { id: 'wa2', parent_id: 'fork', branch: 'no', position: 0, action_type: 'whatsapp_template' },
]
const RUN: JourneyRun = { status: 'done', currentStepId: null, attempts: 0, lastError: null, waitingFor: null, waitDeadline: null, resumeAt: null }
let n = 0
const ev = (stepId: string | null, outcome: string, at: string, extra: Partial<JourneyEvent> = {}): JourneyEvent => ({ id: `e${n++}`, stepId, position: null, outcome, detail: null, actor: null, at, ...extra })
const msg = (stepId: string, status: string, at: string): JourneyMessage => ({ id: `m${n++}`, stepId, channel: 'whatsapp', status, templateName: 't', subject: null, body: 'Hola', error: null, at })

describe('one person\'s journey through an automation', () => {
  it('colours what happened and leaves the path not taken unreached', () => {
    const j = buildJourney(
      STEPS,
      [ev('wa1', 'sent', '2026-09-26T10:00:00Z'), ev('wait', 'waiting', '2026-09-26T10:00:01Z'), ev('fork', 'branched', '2026-09-27T10:00:00Z', { detail: 'No' }), ev('wa2', 'sent', '2026-09-27T10:00:01Z')],
      [msg('wa1', 'read', '2026-09-26T10:00:00Z'), msg('wa2', 'delivered', '2026-09-27T10:00:01Z')],
      RUN,
    )
    expect(j.wa1!.state).toBe('ok')
    expect(j.wa1!.messages).toHaveLength(1)
    expect(j.wait!.state).toBe('ok')
    expect(j.fork!.outlet).toBe('no')
    expect(j.wa2!.state).toBe('ok')
    expect(j.tag!.state).toBe('unreached')
  })

  it('shows where a failed run is stuck, and a step that failed and then went through as done', () => {
    const run: JourneyRun = { ...RUN, status: 'failed', currentStepId: 'wa2', attempts: 3, lastError: 'Meta refused' }
    const j = buildJourney(
      STEPS,
      [ev('wa1', 'failed', '2026-09-26T10:00:00Z'), ev('wa1', 'retried', '2026-09-26T10:05:00Z'), ev('wa1', 'sent', '2026-09-26T10:06:00Z'), ev('fork', 'branched', '2026-09-27T10:00:00Z', { detail: 'No' }), ev('wa2', 'failed', '2026-09-27T10:00:01Z')],
      [],
      run,
    )
    expect(j.wa1!.state).toBe('ok')
    expect(j.wa2!.state).toBe('failed')
    expect(defaultJourneyStep(j, run)).toBe('wa2')
  })

  it('knows a running person is waiting, or retrying on their own', () => {
    const waiting = buildJourney(STEPS, [ev('wa1', 'sent', '2026-09-26T10:00:00Z'), ev('wait', 'waiting', '2026-09-26T10:00:01Z')], [], { ...RUN, status: 'running', currentStepId: 'wait', resumeAt: '2026-09-27T10:00:00Z' })
    expect(waiting.wait!.state).toBe('waiting')
    expect(waiting.fork!.state).toBe('unreached')
    const retrying = buildJourney(STEPS, [ev('wa1', 'failed', '2026-09-26T10:00:00Z')], [], { ...RUN, status: 'running', currentStepId: 'wa1', attempts: 1 })
    expect(retrying.wa1!.state).toBe('retrying')
  })

  it('places history written before steps had ids by its position on the main line', () => {
    const j = buildJourney(STEPS, [ev(null, 'sent', '2026-09-20T10:00:00Z', { position: 0 }), ev(null, 'waiting', '2026-09-20T10:00:01Z', { position: 1 })], [], { ...RUN, status: 'running', currentStepId: 'wait' })
    expect(j.wa1!.state).toBe('ok')
    expect(j.wait!.state).toBe('waiting')
  })

  it('counts a message Meta bounced after it left as failed, and a deliberate skip as skipped', () => {
    const j = buildJourney(STEPS, [ev('wa1', 'sent', '2026-09-26T10:00:00Z'), ev('wait', 'skipped', '2026-09-26T10:00:01Z')], [msg('wa1', 'failed', '2026-09-26T10:00:00Z')], RUN)
    expect(j.wa1!.state).toBe('failed')
    expect(j.wait!.state).toBe('skipped')
  })
})
