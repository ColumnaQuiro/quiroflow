import {
  MAX_STEP_ATTEMPTS,
  RUN_COLUMNS,
  SEQUENCE_TICK_MINUTES,
  delayMinutes,
  logRunEvent,
  sequenceStopReason,
  stopRun,
  type SequenceRun,
} from '~/server/utils/leadSequences'
import {
  runLeadRuleActions,
  runPatientRuleActions,
  runRuleActions,
  type ActionOutcome,
  type ActionRow as SenderAction,
  type LeadForAction,
  type PatientForAction,
  type TriggerBody,
} from '~/server/utils/runAutomationActions'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { mapWithConcurrency } from '~/server/utils/concurrency'
import { sendPushToUsers } from '~/server/utils/pushNotifications'
import { STAGE_TITLES, isLeadStage, type LeadStage } from '~/server/utils/leads'
import { evaluateBranch, fieldsUsed, type BranchConfig, type ConditionFacts } from '~/utils/automationConditions'
import { isValidQuietHours, nextAllowedSendTime, segmentIsDue, type QuietHours, type SegmentSchedule } from '~/utils/automationTiming'
import type { MergeContext } from '~/utils/automationFields'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'

// The automation engine: walks one run of a rule through its steps.
//
// A rule's steps are a tree (automation_actions.parent_id / branch). A rule
// that exists today is a single chain -- its root -- and one whose steps only
// send (WhatsApp, email, webhook) never reaches this file at all:
// dispatchPatientRule sends it through runRuleActions, exactly as before, and
// no run row appears for it. Everything else starts a run
// (automation_sequence_runs) and is walked here, one step at a time, until it
// parks -- at a delay, a wait for an event, a quiet-hours window or a failed
// step -- or its chain ends.
//
// Leads have been walked this way since the welcome drip; that walker lived in
// leadSequences.ts and is now this one. For a linear lead rule nothing is
// different: the same checks before every advance (converted, lost, already a
// patient, PracticeHub deferral, Growth entitlement), the same one-step-at-a-
// time sends through the same sender, the same retry-three-times-then-park,
// the same history rows. growth-lead-sequences.cy.ts is the proof.
//
// Where a run is: `next_position` is the root chain's cursor, exactly as the
// lead code always read it, and it stays the source of truth there -- which is
// what makes this safe to deploy after the migration has already run under
// the previous code. `current_action_id` is the cursor inside a branch's or a
// wait's chain, and the parked step for delays and waits; `waiting_for` says
// what it is parked on ('delay', or the event a wait_until waits for).

/** Steps that send something, through runAutomationActions. */
export const MESSAGE_ACTIONS = ['whatsapp_template', 'email', 'webhook'] as const

/** What a wait_until can wait for. */
export const WAIT_EVENTS = ['appointment.booked', 'whatsapp.replied', 'invoice.paid', 'email.opened', 'email.clicked', 'appointment.checked_in'] as const

/** What can end a run early (automation_rules.exit_on). */
export const EXIT_EVENTS = ['appointment.booked', 'whatsapp.replied', 'lead.converted'] as const

/** How long a wait_until with no timeout waits before taking its timeout path. */
const DEFAULT_WAIT_MINUTES = 7 * 24 * 60

const PATIENT_COLUMNS =
  'id, account_id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact, tags'

export interface EngineAction {
  id: string
  action_type: string
  position: number
  config: Record<string, any>
  parent_id: string | null
  branch: string | null
}

interface EngineRule {
  id: string
  account_id: string
  name: string
  trigger_event: string
  dry_run: boolean
  quiet_hours: QuietHours | null
}

type Subject =
  | { kind: 'lead'; lead: LeadForAction & { stage: string; source?: string | null; channel?: string | null } }
  | { kind: 'patient'; patient: PatientForAction & { tags?: string[] | null } }

interface StepResult {
  status: ActionOutcome['status'] | 'applied'
  detail: string | null
}

const isMessage = (action: { action_type: string }) => (MESSAGE_ACTIONS as readonly string[]).includes(action.action_type)

// ------------------------------------------------------------------ rules

/**
 * Whether firing this rule has to start a run rather than send straight away.
 *
 * False for every rule whose steps only send and whose settings are the
 * defaults -- which, until this change, was every patient rule that did not
 * contain a delay -- so those keep going through runRuleActions untouched.
 */
export async function ruleNeedsRun(supabase: any, ruleId: string): Promise<boolean> {
  const [{ data: rule }, { data: actions }] = await Promise.all([
    supabase.from('automation_rules').select('entry_mode, exit_on, quiet_hours').eq('id', ruleId).maybeSingle(),
    supabase.from('automation_actions').select('action_type, parent_id').eq('rule_id', ruleId),
  ])
  if (!rule) return false
  if ((actions ?? []).some((a: { action_type: string; parent_id: string | null }) => a.parent_id || !isMessage(a))) return true
  if (rule.entry_mode && rule.entry_mode !== 'every_time') return true
  if (Array.isArray(rule.exit_on) && rule.exit_on.length > 0) return true
  return isValidQuietHours(rule.quiet_hours)
}

/**
 * Runs a rule for a patient, the way every patient trigger now does.
 *
 * `supabase` is the caller's own client and is what the immediate path uses,
 * so a rule that only sends behaves exactly as it did (same client, same
 * rows). `service` is the service role, which runs need: their table is
 * read-only to staff, and a run outlives the request that started it.
 */
export async function dispatchPatientRule(
  supabase: any,
  service: any,
  accountId: string,
  ruleId: string,
  patient: PatientForAction,
  origin: string,
  appointmentId?: string,
  triggerBody?: TriggerBody,
  extraContext?: Partial<MergeContext>,
  opts: { force?: boolean } = {},
) {
  if (!(await ruleNeedsRun(service, ruleId))) {
    await runRuleActions(supabase, accountId, ruleId, patient, origin, appointmentId, triggerBody, extraContext)
    return
  }
  await startPatientRun(service, { accountId, ruleId, patientId: patient.id, origin, appointmentId, triggerBody, extraContext, force: opts.force })
}

// ------------------------------------------------------------------ starting

/**
 * Starts a run of a rule for a patient, honouring the rule's entry mode, and
 * walks it up to its first park. Returns the run's id, or null when the entry
 * mode refused it.
 *
 * `force` skips the entry mode: a person pressing "Send now" means it.
 * `advance: false` only enrols -- the segment tick creates runs in bulk and
 * leaves them due, so one tick never tries to message a whole clinic.
 */
export async function startPatientRun(
  supabase: any,
  opts: {
    accountId: string
    ruleId: string
    patientId: string
    origin: string
    appointmentId?: string
    triggerBody?: TriggerBody
    extraContext?: Partial<MergeContext>
    force?: boolean
    advance?: boolean
  },
): Promise<string | null> {
  if (!opts.force) {
    const { data: rule } = await supabase.from('automation_rules').select('entry_mode').eq('id', opts.ruleId).maybeSingle()
    const mode = rule?.entry_mode ?? 'every_time'
    if (mode !== 'every_time') {
      let existing = supabase.from('automation_sequence_runs').select('id').eq('rule_id', opts.ruleId).eq('patient_id', opts.patientId)
      if (mode === 'one_at_a_time') existing = existing.in('status', ['running', 'failed'])
      const { data } = await existing.limit(1)
      if ((data ?? []).length > 0) return null
    }
  }

  const { data: run, error } = await supabase
    .from('automation_sequence_runs')
    .insert({
      account_id: opts.accountId,
      rule_id: opts.ruleId,
      patient_id: opts.patientId,
      appointment_id: opts.appointmentId ?? null,
      context: {
        triggerBody: opts.triggerBody ?? null,
        extraContext: opts.extraContext ?? null,
      },
    })
    .select(RUN_COLUMNS)
    .maybeSingle()
  if (error || !run) {
    if (error) console.error('[automationEngine] could not start a run:', error.message)
    return null
  }

  await logRunEvent(supabase, run, { outcome: 'started', detail: opts.triggerBody?.triggerEvent ?? null })
  if (opts.advance !== false) await advanceRun(supabase, run as SequenceRun, opts.origin)
  return run.id as string
}

/**
 * Starts a sequence for a lead, if one is not already running.
 *
 * The unique index on (rule_id, lead_id) is what actually guarantees this:
 * two webhook deliveries landing together both insert, one loses, and nobody
 * receives the drip twice.
 */
export async function startLeadSequence(supabase: any, accountId: string, ruleId: string, leadId: string, origin: string) {
  const { data: run } = await supabase
    .from('automation_sequence_runs')
    .insert({ account_id: accountId, rule_id: ruleId, lead_id: leadId })
    .select(RUN_COLUMNS)
    .maybeSingle()

  // Null means the unique index refused it: this lead already has a run for
  // this rule, which is exactly the outcome we want.
  if (!run) return null

  await logRunEvent(supabase, run, { outcome: 'started' })
  await advanceRun(supabase, run as SequenceRun, origin)
  return run.id as string
}

/**
 * A person's Retry on a failed run.
 *
 * Resumes at the step that failed -- the cursor never moved past it -- with
 * a fresh set of attempts, and runs it now rather than at the next tick: the
 * person pressing the button is waiting to see whether their fix worked.
 * Everything the cron checks first still applies, so a lead who booked in the
 * meantime is stopped here rather than messaged.
 */
export async function retrySequenceRun(supabase: any, runId: string, accountId: string, actorTeamMemberId: string, origin: string) {
  const { data: run } = await supabase
    .from('automation_sequence_runs')
    .update({ status: 'running', attempts: 0, last_error: null, resume_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('account_id', accountId)
    // Only a failed run. Retrying one that is mid-flight would race the cron
    // for the same step and could send it twice.
    .eq('status', 'failed')
    .select(RUN_COLUMNS)
    .maybeSingle()
  if (!run) return null

  await logRunEvent(supabase, run, { outcome: 'retried', position: run.next_position, actorTeamMemberId })
  await advanceRun(supabase, run as SequenceRun, origin)
  return run.id as string
}

// ------------------------------------------------------------------ walking

/** Kept for callers written against the lead-only runner. */
export const advanceSequenceRun = (supabase: any, run: SequenceRun, origin: string) => advanceRun(supabase, run, origin)

/**
 * Walks a run from where it is until it parks or ends.
 *
 * Actions are re-read every time rather than snapshotted at the start, so a
 * corrected typo reaches the people still mid-run -- and so a failed run that
 * a person has fixed and retried uses the fixed step. The cost is that a
 * shortened rule can leave a run pointing past the end, which is treated as
 * finished rather than as an error -- see 'rule_shortened'.
 *
 * `resume` is how an event wakes a run parked at a wait_until: 'met' takes the
 * met chain. Without it, a parked wait whose deadline has passed takes the
 * timeout chain, and one whose deadline has not is left where it is.
 */
export async function advanceRun(supabase: any, run: SequenceRun, origin: string, opts: { resume?: 'met' } = {}) {
  const subject = await loadSubject(supabase, run)
  if (!subject) return

  const [{ data: ruleRow }, { data: actionRows }] = await Promise.all([
    supabase.from('automation_rules').select('id, account_id, name, trigger_event, dry_run, quiet_hours').eq('id', run.rule_id).maybeSingle(),
    supabase.from('automation_actions').select('id, action_type, position, config, parent_id, branch').eq('rule_id', run.rule_id).order('position'),
  ])
  const rule: EngineRule = ruleRow ?? { id: run.rule_id, account_id: run.account_id, name: '', trigger_event: '', dry_run: false, quiet_hours: null }
  const actions = ((actionRows ?? []) as EngineAction[]).map((a) => ({ ...a, parent_id: a.parent_id ?? null, branch: a.branch ?? null, config: a.config ?? {} }))

  const chainOf = (parentId: string | null, branch: string | null) => actions.filter((a) => a.parent_id === parentId && a.branch === branch)
  const root = chainOf(null, null)
  const nextInChain = (action: EngineAction) => chainOf(action.parent_id, action.branch).find((a) => a.position > action.position) ?? null
  const current = run.current_action_id ? (actions.find((a) => a.id === run.current_action_id) ?? null) : null
  const waitingEvent = run.waiting_for && run.waiting_for !== 'delay' ? run.waiting_for : null

  // ---- where to start
  let start: EngineAction | null
  if (current && waitingEvent && current.action_type === 'wait_until') {
    const deadlinePassed = !run.wait_deadline || new Date(run.wait_deadline).getTime() <= Date.now()
    const outlet = opts.resume ?? (deadlinePassed ? 'timeout' : null)
    if (!outlet) {
      // Woken early by the tick (a retry, or a clock edge): nothing to do yet.
      await supabase.from('automation_sequence_runs').update({ resume_at: run.wait_deadline }).eq('id', run.id)
      return
    }
    // The claim: only one of the event and the cron takes this outlet. The
    // other finds waiting_for already cleared and leaves the run alone.
    const { data: claimed } = await supabase
      .from('automation_sequence_runs')
      .update({ waiting_for: null, wait_deadline: null, branch_taken: outlet })
      .eq('id', run.id)
      .eq('status', 'running')
      .eq('waiting_for', waitingEvent)
      .select('id')
      .maybeSingle()
    if (!claimed) return
    await logRunEvent(supabase, run, {
      outcome: outlet === 'met' ? 'met' : 'timed_out',
      position: current.parent_id ? null : current.position,
      action: current,
      detail: outlet === 'met' ? `${waitingEvent} happened` : `No ${waitingEvent} before the deadline`,
    })
    start = chainOf(current.id, outlet)[0] ?? null
    if (!start) return finish(supabase, run, root, current)
  } else if (current && current.parent_id) {
    start = run.waiting_for === 'delay' ? nextInChain(current) : current
    if (!start) return finish(supabase, run, root, current)
  } else {
    // The root chain, read the way the lead runner always read it.
    const remaining = root.filter((a) => a.position >= run.next_position)
    if (remaining.length === 0) {
      const finishedNormally = root.length > 0 && run.next_position > root[root.length - 1]!.position
      if (finishedNormally) return finish(supabase, run, root, null)
      return stopRun(supabase, run, 'rule_shortened')
    }
    start = remaining[0]!
  }

  const tz = await clinicTimezone(supabase, run)
  let attempts = run.attempts ?? 0
  let action: EngineAction | null = start
  let last: EngineAction | null = null

  while (action) {
    const isRoot = action.parent_id === null
    const next = nextInChain(action)
    const position = isRoot ? { next_position: action.position + 1 } : {}
    const eventPosition = isRoot ? action.position : null

    if (action.action_type === 'delay') {
      let resumeAt = new Date(Date.now() + delayMinutes(action.config) * 60_000)
      // A wait that ends at 3 a.m. should not send at 3 a.m.
      if (next && isMessage(next) && rule.quiet_hours) resumeAt = nextAllowedSendTime(resumeAt, rule.quiet_hours, tz)
      const resume = resumeAt.toISOString()
      await supabase
        .from('automation_sequence_runs')
        .update({ ...position, resume_at: resume, attempts: 0, last_error: null, current_action_id: action.id, waiting_for: 'delay', wait_deadline: null })
        .eq('id', run.id)
      await logRunEvent(supabase, run, { outcome: 'waiting', position: eventPosition, action, detail: `Until ${resume}` })
      return
    }

    if (action.action_type === 'wait_until') {
      const event = String(action.config?.event ?? '')
      if (!(WAIT_EVENTS as readonly string[]).includes(event)) {
        await logRunEvent(supabase, run, { outcome: 'skipped', position: eventPosition, action, detail: `Unknown event "${event}"; taking the timeout path.` })
        await supabase.from('automation_sequence_runs').update({ ...position, current_action_id: action.id, branch_taken: 'timeout' }).eq('id', run.id)
        last = action
        action = chainOf(action.id, 'timeout')[0] ?? null
        continue
      }
      const minutes = Number(action.config?.timeout_minutes)
      const timeout = Number.isFinite(minutes) && minutes > 0 ? Math.max(minutes, SEQUENCE_TICK_MINUTES) : DEFAULT_WAIT_MINUTES
      const deadline = new Date(Date.now() + timeout * 60_000).toISOString()
      await supabase
        .from('automation_sequence_runs')
        .update({ ...position, current_action_id: action.id, waiting_for: event, wait_deadline: deadline, resume_at: deadline, attempts: 0, last_error: null })
        .eq('id', run.id)
      await logRunEvent(supabase, run, { outcome: 'waiting', position: eventPosition, action, detail: `Until ${event}, or ${deadline}` })
      return
    }

    if (action.action_type === 'branch') {
      const yes = evaluateBranch(action.config as BranchConfig, await branchFacts(supabase, run, subject, action.config as BranchConfig))
      const outlet = yes ? 'yes' : 'no'
      const first: EngineAction | null = chainOf(action.id, outlet)[0] ?? null
      await supabase
        .from('automation_sequence_runs')
        .update({ ...position, branch_taken: outlet, current_action_id: first?.id ?? null, waiting_for: null, attempts: 0, last_error: null })
        .eq('id', run.id)
      await logRunEvent(supabase, run, { outcome: 'branched', position: eventPosition, action, detail: yes ? 'Yes' : 'No' })
      last = action
      action = first
      continue
    }

    if (isMessage(action) && rule.quiet_hours) {
      const allowedAt = nextAllowedSendTime(new Date(), rule.quiet_hours, tz)
      if (allowedAt.getTime() > Date.now()) {
        const detail = `Quiet hours: sending at ${allowedAt.toISOString()}.`
        await supabase
          .from('automation_sequence_runs')
          .update({ current_action_id: action.id, waiting_for: null, resume_at: allowedAt.toISOString(), last_error: null })
          .eq('id', run.id)
        await logRunEvent(supabase, run, { outcome: 'deferred', position: eventPosition, action, detail })
        return
      }
    }

    const result = isMessage(action) ? await sendStep(supabase, run, subject, action, origin) : await applyStep(supabase, run, rule, subject, action)

    if (result.status === 'failed') {
      attempts += 1
      const exhausted = attempts >= MAX_STEP_ATTEMPTS
      // The cursor does NOT move: the next attempt -- automatic, or a
      // person's Retry -- starts at this step, and only this step. Everything
      // before it was saved as it went, so nothing is sent twice.
      await supabase
        .from('automation_sequence_runs')
        .update(
          exhausted
            ? { status: 'failed', attempts, last_error: result.detail, current_action_id: action.id, waiting_for: null }
            : {
                attempts,
                last_error: result.detail,
                resume_at: new Date(Date.now() + SEQUENCE_TICK_MINUTES * 60_000).toISOString(),
                current_action_id: action.id,
                waiting_for: null,
              },
        )
        .eq('id', run.id)
      await logRunEvent(supabase, run, {
        outcome: 'failed',
        position: eventPosition,
        action,
        detail: exhausted
          ? `${result.detail} -- attempt ${attempts} of ${MAX_STEP_ATTEMPTS}; stopped until someone retries it.`
          : `${result.detail} -- attempt ${attempts} of ${MAX_STEP_ATTEMPTS}; trying again in ${SEQUENCE_TICK_MINUTES} minutes.`,
      })
      return
    }

    attempts = 0
    // Saved after every step, not only at delays. Two sends back to back
    // where the second fails used to mean a retry from the last delay --
    // sending the first one again.
    await supabase
      .from('automation_sequence_runs')
      .update({ ...position, attempts: 0, last_error: null, current_action_id: next?.id ?? null, waiting_for: null })
      .eq('id', run.id)
    await logRunEvent(supabase, run, { outcome: result.status, position: eventPosition, action, detail: result.detail })
    last = action
    action = next
  }

  return finish(supabase, run, root, last)
}

/** The end of a chain is the end of the run. */
async function finish(supabase: any, run: SequenceRun, root: EngineAction[], last: EngineAction | null) {
  // For the root chain the cursor ends one past its last step, exactly as the
  // lead runner left it -- the Executions tab reads "finished" from that.
  const endedInRoot = !last || last.parent_id === null
  await supabase
    .from('automation_sequence_runs')
    .update({
      status: 'done',
      ...(endedInRoot ? { next_position: (root[root.length - 1]?.position ?? 0) + 1 } : {}),
      attempts: 0,
      last_error: null,
      current_action_id: null,
      waiting_for: null,
      wait_deadline: null,
    })
    .eq('id', run.id)
  await logRunEvent(supabase, run, { outcome: 'finished' })
}

/**
 * Who the run is for, re-read and re-checked before every advance. Null means
 * the run was stopped (or, for a lead, deferred) and there is nothing to do.
 */
async function loadSubject(supabase: any, run: SequenceRun): Promise<Subject | null> {
  if (run.lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, full_name, email, phone, stage, patient_id, deleted_at, marketing_consent_at, source, channel')
      .eq('id', run.lead_id)
      .maybeSingle()

    if (!lead) {
      await stopRun(supabase, run, 'lead_deleted')
      return null
    }

    // A drip that keeps messaging strangers after the clinic stopped paying
    // for the thing sending them is indefensible, so an in-flight sequence
    // stops with the reason on it. past_due is deliberately not one of the
    // statuses that stop: a card that failed this morning should not silently
    // abandon somebody mid-conversation.
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('plan_id, growth_addon, status, comped')
      .eq('account_id', run.account_id)
      .maybeSingle()
    if (!hasGrowth(subscription)) {
      await stopRun(supabase, run, 'not_entitled')
      return null
    }

    const verdict = await sequenceStopReason(supabase, run.account_id, lead)
    if (verdict === 'defer') {
      // Left running and due again shortly, so the next tick re-asks rather
      // than this one guessing. Recorded once per outage, not once per tick:
      // a PracticeHub that is down all afternoon is one line in the history,
      // not sixteen.
      const deferral = 'PracticeHub could not be reached to check whether this lead is already a patient; trying again shortly.'
      await supabase
        .from('automation_sequence_runs')
        .update({ resume_at: new Date(Date.now() + SEQUENCE_TICK_MINUTES * 60_000).toISOString(), last_error: deferral })
        .eq('id', run.id)
      if (run.last_error !== deferral) await logRunEvent(supabase, run, { outcome: 'deferred', detail: deferral })
      return null
    }
    if (verdict) {
      await stopRun(supabase, run, verdict)
      return null
    }
    return { kind: 'lead', lead }
  }

  const { data: patient } = run.patient_id
    ? await supabase.from('patients').select(PATIENT_COLUMNS).eq('id', run.patient_id).maybeSingle()
    : { data: null }
  if (!patient) {
    await stopRun(supabase, run, 'patient_deleted')
    return null
  }
  return { kind: 'patient', patient }
}

/** The clinic whose clock quiet hours are read on: the appointment's, else the account's first. */
async function clinicTimezone(supabase: any, run: SequenceRun): Promise<string> {
  if (run.appointment_id) {
    const { data } = await supabase.from('appointments').select('clinics(timezone)').eq('id', run.appointment_id).maybeSingle()
    const tz = (data?.clinics as { timezone?: string | null } | null)?.timezone
    if (tz) return tz
  }
  const { data: clinic } = await supabase
    .from('clinics')
    .select('timezone')
    .eq('account_id', run.account_id)
    .is('archived_at', null)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  return clinic?.timezone || DEFAULT_CLINIC_TIMEZONE
}

// ------------------------------------------------------------------ steps

/** One message step through the existing sender, for whichever kind of person the run is for. */
async function sendStep(supabase: any, run: SequenceRun, subject: Subject, action: EngineAction, origin: string): Promise<StepResult> {
  const step = [{ id: action.id, action_type: action.action_type, config: action.config }] as SenderAction[]
  if (subject.kind === 'lead') {
    // One action at a time through the existing sender, so a lead gets the
    // same consent gate, the same template resolution and the same message
    // log a patient would.
    const [outcome] = await runLeadRuleActions(supabase, run.account_id, run.rule_id, subject.lead, origin, undefined, step)
    return { status: outcome?.status ?? 'sent', detail: outcome?.detail ?? null }
  }
  const context = (run.context ?? {}) as { triggerBody?: TriggerBody | null; extraContext?: Partial<MergeContext> | null }
  const [outcome] = await runPatientRuleActions(
    supabase,
    run.account_id,
    run.rule_id,
    subject.patient,
    origin,
    run.appointment_id ?? undefined,
    context.triggerBody ?? undefined,
    context.extraContext ?? undefined,
    step,
  )
  return { status: outcome?.status ?? 'sent', detail: outcome?.detail ?? null }
}

/** The steps that do something inside QuiroFlow rather than send. */
async function applyStep(supabase: any, run: SequenceRun, rule: EngineRule, subject: Subject, action: EngineAction): Promise<StepResult> {
  const config = action.config ?? {}
  // Test mode changes nothing, on every kind of step -- the same promise the
  // message steps keep by recording instead of sending.
  const testMode = (what: string): StepResult => ({ status: 'dry_run', detail: `Test mode: ${what}` })

  try {
    switch (action.action_type) {
      case 'tag': {
        if (subject.kind !== 'patient') return { status: 'skipped', detail: 'Tags apply to patients, not leads.' }
        const tag = String(config.tag ?? '').trim()
        if (!tag) return { status: 'failed', detail: 'The tag step has no tag.' }
        const remove = config.mode === 'remove'
        if (rule.dry_run) return testMode(`the tag "${tag}" was not ${remove ? 'removed' : 'added'}.`)
        const { data: row } = await supabase.from('patients').select('tags').eq('id', subject.patient.id).maybeSingle()
        const tags: string[] = row?.tags ?? []
        const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        if (remove ? !has : has) return { status: 'applied', detail: remove ? `Did not have the tag "${tag}".` : `Already tagged "${tag}".` }
        const nextTags = remove ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag]
        const { error } = await supabase.from('patients').update({ tags: nextTags }).eq('id', subject.patient.id)
        if (error) return { status: 'failed', detail: `Could not change tags: ${error.message}` }
        return { status: 'applied', detail: remove ? `Removed the tag "${tag}".` : `Added the tag "${tag}".` }
      }

      case 'notify': {
        // Phase 1: a push to the chosen team members' devices (web and app).
        // TODO(automations phase 3): also create a task in the recipients'
        // "Mi día" list, so a notification nobody saw is still waiting there.
        const memberIds = await notifyRecipients(supabase, run, config)
        if (memberIds.length === 0) return { status: 'skipped', detail: 'Nobody to notify: no team member matches this step.' }
        if (rule.dry_run) return testMode(`${memberIds.length} team member(s) were not notified.`)
        const { data: members } = await supabase.from('team_members').select('user_id').in('id', memberIds).not('user_id', 'is', null)
        const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
        const who = subject.kind === 'patient' ? `${subject.patient.first_name} ${subject.patient.last_name ?? ''}`.trim() : subject.lead.full_name
        const pushed = await sendPushToUsers(supabase, userIds, {
          title: String(config.title || rule.name || 'Automatización'),
          body: who,
          data: {
            type: 'automation',
            ruleId: run.rule_id,
            ...(subject.kind === 'patient' ? { patientId: subject.patient.id } : { leadId: subject.lead.id }),
          },
        })
        return { status: 'applied', detail: `Notified ${memberIds.length} team member(s) on ${pushed.attempted} device(s).` }
      }

      case 'lead_stage':
      case 'lead_assign': {
        if (subject.kind !== 'lead') return { status: 'skipped', detail: 'This step only applies to leads.' }
        // Belt and braces: a lead run without Growth was already stopped
        // before reaching here (not_entitled).
        const { data: subscription } = await supabase.from('subscriptions').select('plan_id, growth_addon, status, comped').eq('account_id', run.account_id).maybeSingle()
        if (!hasGrowth(subscription)) return { status: 'skipped', detail: 'Growth is not on the subscription.' }

        if (action.action_type === 'lead_stage') {
          const stage = config.stage
          if (!isLeadStage(stage)) return { status: 'failed', detail: `Unknown lead stage "${String(stage)}".` }
          if (rule.dry_run) return testMode(`the lead was not moved to ${STAGE_TITLES[stage as LeadStage]}.`)
          const before = subject.lead.stage
          if (before === stage) return { status: 'applied', detail: `Already in ${STAGE_TITLES[stage as LeadStage]}.` }
          const { error } = await supabase.from('leads').update({ stage }).eq('id', subject.lead.id)
          if (error) return { status: 'failed', detail: `Could not move the lead: ${error.message}` }
          // The same timeline entry a drag on the board writes.
          await supabase.from('lead_events').insert({
            account_id: run.account_id,
            lead_id: subject.lead.id,
            kind: 'stage_change',
            title: `Moved to ${STAGE_TITLES[stage as LeadStage]}`,
            detail: `From ${STAGE_TITLES[before as LeadStage] ?? before} (automation: ${rule.name})`,
          })
          return { status: 'applied', detail: `Moved to ${STAGE_TITLES[stage as LeadStage]}.` }
        }

        const memberId = String(config.team_member_id ?? '')
        const { data: member } = memberId
          ? await supabase.from('team_members').select('id, full_name').eq('id', memberId).eq('account_id', run.account_id).is('deleted_at', null).maybeSingle()
          : { data: null }
        if (!member) return { status: 'failed', detail: 'The team member to assign is not in this clinic.' }
        if (rule.dry_run) return testMode(`the lead was not assigned to ${member.full_name}.`)
        const { error } = await supabase.from('leads').update({ owner_team_member_id: member.id }).eq('id', subject.lead.id)
        if (error) return { status: 'failed', detail: `Could not assign the lead: ${error.message}` }
        return { status: 'applied', detail: `Assigned to ${member.full_name}.` }
      }

      default:
        return { status: 'skipped', detail: `Unknown step "${action.action_type}".` }
    }
  } catch (err) {
    return { status: 'failed', detail: (err as Error)?.message ?? String(err) }
  }
}

/** Which team members a notify step reaches. */
async function notifyRecipients(supabase: any, run: SequenceRun, config: Record<string, any>): Promise<string[]> {
  const to = (config.to ?? {}) as { team_member_id?: string; role_id?: string; practitioner_of_appointment?: boolean }
  const ids = new Set<string>()
  if (to.team_member_id) ids.add(to.team_member_id)
  if (to.role_id) {
    const { data } = await supabase.from('team_members').select('id').eq('account_id', run.account_id).eq('role_id', to.role_id).is('deleted_at', null)
    for (const m of data ?? []) ids.add(m.id)
  }
  if (to.practitioner_of_appointment && run.appointment_id) {
    const { data } = await supabase.from('appointments').select('practitioner_id').eq('id', run.appointment_id).maybeSingle()
    if (data?.practitioner_id) ids.add(data.practitioner_id)
  }
  if (ids.size === 0) return []
  // Only this clinic's people, whatever the config says.
  const { data: members } = await supabase.from('team_members').select('id').eq('account_id', run.account_id).is('deleted_at', null).in('id', [...ids])
  return (members ?? []).map((m: { id: string }) => m.id)
}

/** The facts a branch asks about, looked up only for the fields it uses. */
async function branchFacts(supabase: any, run: SequenceRun, subject: Subject, config: BranchConfig): Promise<ConditionFacts> {
  const used = fieldsUsed(config)
  const facts: ConditionFacts = {}
  const { data: started } = await supabase.from('automation_sequence_runs').select('started_at').eq('id', run.id).maybeSingle()
  const since = started?.started_at ?? new Date(0).toISOString()

  if (subject.kind === 'patient') {
    const p = subject.patient
    const { data: fresh } = await supabase.from('patients').select('tags, marketing_channels, email').eq('id', p.id).maybeSingle()
    if (used.has('tags')) facts.tags = fresh?.tags ?? []
    if (used.has('marketing_channels')) facts.marketing_channels = fresh?.marketing_channels ?? []
    if (used.has('has_email')) facts.has_email = Boolean(fresh?.email)
    if (used.has('has_phone')) {
      const { count } = await supabase.from('patient_contact_numbers').select('id', { count: 'exact', head: true }).eq('patient_id', p.id)
      facts.has_phone = (count ?? 0) > 0
    }
    if (used.has('has_future_appointment')) {
      const { count } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('patient_id', p.id)
        .eq('status', 'booked')
        .gt('starts_at', new Date().toISOString())
      facts.has_future_appointment = (count ?? 0) > 0
    }
    if (used.has('total_visits')) {
      const { count } = await supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', p.id).eq('status', 'completed')
      facts.total_visits = count ?? 0
    }
    if (used.has('balance_cents')) {
      const { data } = await supabase.from('patient_live_balances').select('balance_cents').eq('patient_id', p.id).maybeSingle()
      facts.balance_cents = data?.balance_cents ?? 0
    }
    if (used.has('membership_active')) {
      const { count } = await supabase.from('patient_memberships').select('id', { count: 'exact', head: true }).eq('patient_id', p.id).eq('status', 'active')
      facts.membership_active = (count ?? 0) > 0
    }
    if ((used.has('appointment_type_id') || used.has('practitioner_id')) && run.appointment_id) {
      const { data } = await supabase.from('appointments').select('appointment_type_id, practitioner_id').eq('id', run.appointment_id).maybeSingle()
      facts.appointment_type_id = data?.appointment_type_id ?? null
      facts.practitioner_id = data?.practitioner_id ?? null
    }
  } else {
    const lead = subject.lead
    if (used.has('lead_stage')) facts.lead_stage = lead.stage
    if (used.has('lead_source')) facts.lead_source = lead.source ?? null
    if (used.has('lead_channel')) facts.lead_channel = lead.channel ?? null
    if (used.has('has_email')) facts.has_email = Boolean(lead.email)
    if (used.has('has_phone')) facts.has_phone = Boolean(lead.phone)
  }

  const who = subject.kind === 'patient' ? { column: 'patient_id', id: subject.patient.id } : { column: 'lead_id', id: subject.lead.id }
  if (used.has('replied_since_start')) {
    const { count } = await supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq(who.column, who.id)
      .eq('direction', 'inbound')
      .gte('created_at', since)
    facts.replied_since_start = (count ?? 0) > 0
  }
  if (used.has('email_opened_since_start') || used.has('email_clicked_since_start')) {
    const { data } = await supabase
      .from('email_messages')
      .select('first_opened_at, first_clicked_at')
      .eq(who.column, who.id)
      .eq('rule_id', run.rule_id)
      .gte('sent_at', since)
    facts.email_opened_since_start = (data ?? []).some((e: { first_opened_at: string | null }) => e.first_opened_at)
    facts.email_clicked_since_start = (data ?? []).some((e: { first_clicked_at: string | null }) => e.first_clicked_at)
  }
  return facts
}

// ------------------------------------------------------------------ events

/**
 * Something happened to a person that a run may be waiting for, or that ends
 * it. Called wherever the event is observed -- /api/automations/fire for the
 * app's own triggers, the WhatsApp and Resend webhooks, lead conversion.
 *
 * Exits are applied first: a rule that both waits for a booking and exits on
 * one ends, rather than taking its "met" path. Best-effort from the caller's
 * point of view -- it never throws.
 */
export async function automationEvent(
  supabase: any,
  accountId: string,
  subject: { patientId?: string | null; leadId?: string | null },
  event: string,
  origin: string,
) {
  try {
    const column = subject.patientId ? 'patient_id' : subject.leadId ? 'lead_id' : null
    const id = subject.patientId ?? subject.leadId
    if (!column || !id) return

    if ((EXIT_EVENTS as readonly string[]).includes(event)) {
      const { data: live } = await supabase
        .from('automation_sequence_runs')
        .select('id, account_id, rule_id, automation_rules(exit_on)')
        .eq('account_id', accountId)
        .eq(column, id)
        .in('status', ['running', 'failed'])
      for (const run of live ?? []) {
        const exitOn = ((run.automation_rules as { exit_on?: string[] } | null)?.exit_on ?? []) as string[]
        if (!exitOn.includes(event)) continue
        await stopRun(supabase, run, 'exited', `Left the automation: ${event}.`)
      }
    }

    if ((WAIT_EVENTS as readonly string[]).includes(event)) {
      const { data: waiting } = await supabase
        .from('automation_sequence_runs')
        .select(RUN_COLUMNS)
        .eq('account_id', accountId)
        .eq(column, id)
        .eq('status', 'running')
        .eq('waiting_for', event)
      for (const run of waiting ?? []) {
        await advanceRun(supabase, run as SequenceRun, origin, { resume: 'met' })
      }
    }
  } catch (err) {
    console.error(`[automationEngine] ${event} could not be applied to runs:`, (err as Error)?.message ?? err)
  }
}

// ------------------------------------------------------------------ segments

interface SegmentConfig {
  filters?: AutomationFilters
  schedule?: SegmentSchedule
  reentry_days?: number
}

/**
 * Enrols the patients a scheduled segment rule matches, for every segment rule
 * that is due. Run from the lead-sequence tick (already scheduled in
 * production). Enrolment only creates the runs, due now; the same tick -- or
 * the next -- walks them, under the usual per-tick cap.
 *
 * Consent is honoured at enrolment (nobody who cannot be contacted is
 * enrolled, and a marketing rule enrols nobody with no marketing channel at
 * all) and again, per channel, at every send.
 */
export async function enrolDueSegments(supabase: any, origin: string, now = new Date()): Promise<number> {
  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, account_id, segment, segment_last_run_at, created_at, is_marketing')
    .eq('trigger_event', 'segment')
    .eq('enabled', true)
  let enrolled = 0

  for (const rule of rules ?? []) {
    try {
      const segment = (rule.segment ?? {}) as SegmentConfig
      const { data: clinic } = await supabase
        .from('clinics')
        .select('timezone')
        .eq('account_id', rule.account_id)
        .is('archived_at', null)
        .order('created_at')
        .limit(1)
        .maybeSingle()
      const tz = clinic?.timezone || DEFAULT_CLINIC_TIMEZONE
      const lastRun = rule.segment_last_run_at ? new Date(rule.segment_last_run_at) : null
      if (!segmentIsDue(segment.schedule, lastRun, new Date(rule.created_at), now, tz)) continue

      // The claim: two overlapping ticks cannot both enrol the same occurrence.
      let claim = supabase.from('automation_rules').update({ segment_last_run_at: now.toISOString() }).eq('id', rule.id)
      claim = rule.segment_last_run_at ? claim.eq('segment_last_run_at', rule.segment_last_run_at) : claim.is('segment_last_run_at', null)
      const { data: claimed } = await claim.select('id').maybeSingle()
      if (!claimed) continue

      const { data: patients } = await supabase
        .from('patients')
        .select('id, is_minor, do_not_contact, marketing_channels')
        .eq('account_id', rule.account_id)
      let candidates = (patients ?? []).filter(
        (p: { is_minor: boolean; do_not_contact: boolean; marketing_channels: string[] | null }) =>
          !p.is_minor && !p.do_not_contact && (!rule.is_marketing || (p.marketing_channels ?? []).length > 0),
      )

      const reentryDays = Number(segment.reentry_days)
      if (Number.isFinite(reentryDays) && reentryDays > 0) {
        const since = new Date(now.getTime() - reentryDays * 24 * 3600 * 1000).toISOString()
        const { data: recent } = await supabase.from('automation_sequence_runs').select('patient_id').eq('rule_id', rule.id).gte('started_at', since)
        const recentIds = new Set((recent ?? []).map((r: { patient_id: string }) => r.patient_id))
        candidates = candidates.filter((p: { id: string }) => !recentIds.has(p.id))
      }

      const flags = await mapWithConcurrency(candidates, 5, async (p: { id: string }) => {
        if (!(await ruleFiltersMatch(supabase, p.id, segment.filters))) return false
        const runId = await startPatientRun(supabase, {
          accountId: rule.account_id,
          ruleId: rule.id,
          patientId: p.id,
          origin,
          triggerBody: { triggerEvent: 'segment', patientId: p.id },
          advance: false,
        })
        return Boolean(runId)
      })
      enrolled += flags.filter(Boolean).length
    } catch (err) {
      console.error('[automationEngine] segment enrolment failed for rule', rule.id, (err as Error)?.message ?? err)
    }
  }
  return enrolled
}
