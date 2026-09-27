// One person's journey through an automation, step by step -- what the
// People tab draws on the canvas, n8n-style: every step coloured by what
// happened to them, the path they took through each fork, and the messages
// each step sent.
//
// Pure, from what the run detail endpoint returns: the run, its history
// (automation_run_events) and the messages it sent (whatsapp_messages /
// email_messages), against the rule's steps as the builder holds them.

export type JourneyState =
  | 'ok' // done: sent, applied, branched, waited
  | 'failed' // could not be done (the run parked here, or Meta refused the message)
  | 'retrying' // failed, and trying again on its own
  | 'waiting' // parked here, waiting for time or an event
  | 'current' // next to run
  | 'skipped' // deliberately not done (no consent, not applicable)
  | 'unreached' // they never got here

export interface JourneyStep {
  id: string
  parent_id: string | null
  branch: string | null
  position: number
  action_type: string
}

export interface JourneyEvent {
  id: string
  stepId: string | null
  position: number | null
  outcome: string
  detail: string | null
  actor: string | null
  at: string
}

export interface JourneyMessage {
  id: string
  stepId: string | null
  channel: 'whatsapp' | 'email'
  /** whatsapp: sent / delivered / read / failed / would_send; email: sent / delivered / opened / clicked / bounced / failed / dry_run */
  status: string
  templateName: string | null
  subject: string | null
  body: string | null
  error: string | null
  at: string
  deliveredAt?: string | null
  openedAt?: string | null
  clickedAt?: string | null
}

export interface JourneyRun {
  status: string // running / done / failed / cancelled
  currentStepId: string | null
  attempts: number
  lastError: string | null
  waitingFor: string | null
  waitDeadline: string | null
  resumeAt: string | null
}

export interface StepJourney {
  state: JourneyState
  /** For a fork: the outlet they went down (yes / no, met / timeout). */
  outlet: string | null
  events: JourneyEvent[]
  messages: JourneyMessage[]
  /** When this step last did something. */
  at: string | null
}

const DONE = new Set(['sent', 'dry_run', 'applied', 'branched', 'met', 'timed_out'])

/**
 * Which step an event belongs to. Events recorded before steps carried an id
 * (automation_run_events.action_id) have only their position on the main
 * line -- which is all a flow had then.
 */
function stepOf(e: JourneyEvent, steps: JourneyStep[]): string | null {
  if (e.stepId) return e.stepId
  if (e.position === null || e.position === undefined) return null
  return steps.find((s) => !s.parent_id && s.position === e.position)?.id ?? null
}

/** Meta or the mail provider refused it after it left: that is a failure too. */
function messageFailed(m: JourneyMessage) {
  return m.status === 'failed' || m.status === 'bounced'
}

export function buildJourney(steps: JourneyStep[], events: JourneyEvent[], messages: JourneyMessage[], run: JourneyRun): Record<string, StepJourney> {
  const out: Record<string, StepJourney> = {}
  for (const s of steps) out[s.id] = { state: 'unreached', outlet: null, events: [], messages: [], at: null }

  for (const e of events) {
    const id = stepOf(e, steps)
    if (id && out[id]) out[id].events.push(e)
  }
  for (const m of messages) {
    if (m.stepId && out[m.stepId]) out[m.stepId].messages.push(m)
  }

  for (const s of steps) {
    const j = out[s.id]!
    j.events.sort((a, b) => a.at.localeCompare(b.at))
    j.messages.sort((a, b) => a.at.localeCompare(b.at))
    const last = j.events[j.events.length - 1]
    j.at = [last?.at, j.messages[j.messages.length - 1]?.at].filter(Boolean).sort().pop() ?? null

    // The path taken through a fork.
    for (const e of j.events) {
      if (e.outcome === 'branched') j.outlet = /^yes$/i.test(e.detail ?? '') ? 'yes' : 'no'
      if (e.outcome === 'met') j.outlet = 'met'
      if (e.outcome === 'timed_out') j.outlet = 'timeout'
    }

    const isCurrent = run.currentStepId === s.id
    if (isCurrent && run.status === 'failed') {
      j.state = 'failed'
    } else if (isCurrent && run.status === 'running') {
      if (last?.outcome === 'failed') j.state = 'retrying'
      else if (last && (last.outcome === 'waiting' || last.outcome === 'deferred')) j.state = 'waiting'
      else if (s.action_type === 'delay' || s.action_type === 'wait_until') j.state = 'waiting'
      else j.state = 'current'
    } else if (!last && j.messages.length === 0) {
      j.state = 'unreached'
    } else if (j.events.some((e) => DONE.has(e.outcome))) {
      j.state = 'ok'
    } else if (last?.outcome === 'skipped') {
      j.state = 'skipped'
    } else if (last?.outcome === 'failed') {
      j.state = 'failed'
    } else {
      // Waited and moved on, or messages with no event (sent before steps kept a history).
      j.state = 'ok'
    }

    // A message that left and then bounced back from Meta is not "ok".
    if (j.state === 'ok' && j.messages.length > 0 && j.messages.every(messageFailed)) j.state = 'failed'
  }
  return out
}

/** The step to open first: where they are stuck, else where they are, else the last thing that happened. */
export function defaultJourneyStep(journey: Record<string, StepJourney>, run: JourneyRun): string | null {
  if (run.currentStepId && journey[run.currentStepId]) return run.currentStepId
  const failed = Object.entries(journey).find(([, j]) => j.state === 'failed')
  if (failed) return failed[0]
  const touched = Object.entries(journey).filter(([, j]) => j.at).sort((a, b) => (a[1].at! < b[1].at! ? 1 : -1))
  return touched[0]?.[0] ?? null
}

/** What the builder canvas needs to draw one journey (components/automations/FlowCanvas.vue). */
export interface CanvasJourney {
  steps: Record<string, { state: JourneyState; note: string; outlet: string | null }>
  triggerNote: string
  picked: string | null
}
