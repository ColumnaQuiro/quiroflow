import { phoneMatches } from '~/utils/phone'

// A multi-step automation for a lead: send, wait, send again, and stop the
// moment it stops being appropriate.
//
// This file is the lead half of it: when a lead should stop being messaged
// (sequenceStopReason and the PracticeHub check), and the shared vocabulary of
// a run's history (logRunEvent, stepLabel, the stop reasons). Advancing a run
// -- lead or patient -- is server/utils/automationEngine.ts, which calls the
// checks below before every step exactly as this file used to.

/** The cron ticks every 15 minutes, so that is the real floor for any delay. */
export const SEQUENCE_TICK_MINUTES = 15

export interface SequenceRun {
  id: string
  account_id: string
  rule_id: string
  /** Exactly one of lead_id / patient_id is set. */
  lead_id: string | null
  patient_id?: string | null
  appointment_id?: string | null
  context?: Record<string, any> | null
  current_action_id?: string | null
  next_position: number
  waiting_for?: string | null
  wait_deadline?: string | null
  attempts?: number
  last_error?: string | null
}

/** What every caller has to select for the engine to advance a run. */
export const RUN_COLUMNS =
  'id, account_id, rule_id, lead_id, patient_id, appointment_id, context, current_action_id, next_position, waiting_for, wait_deadline, attempts, last_error'

export type StopReason =
  | 'converted'
  | 'already_a_patient'
  | 'lead_deleted'
  | 'lost'
  | 'no_contact'
  | 'rule_shortened'
  | 'not_entitled'
  | 'patient_deleted'
  | 'exited'

/**
 * 'defer' is the third answer, and the reason this is not a boolean.
 *
 * While QuiroFlow and PracticeHub are dual-running, somebody can be a patient
 * there and not here, so the check has to reach an external API -- which can
 * be down. Both obvious responses to that are wrong: carrying on risks
 * messaging somebody who booked last week, and stopping risks cancelling
 * every clinic's drip because a third party had a bad afternoon.
 *
 * So an unreachable PracticeHub defers. The run stays due and the next tick
 * tries again: the drip is delayed rather than wrong or destroyed, and a long
 * outage costs lateness instead of trust. A clinic with no PracticeHub
 * configured skips the check entirely rather than deferring forever.
 */
export type SequenceVerdict = StopReason | 'defer' | null

/**
 * Whether this lead should still be receiving the sequence.
 *
 * Re-checked before every step, not once at the start -- the entire value of
 * the drip is that it stops when it should, and between one message and the
 * next the person may have booked, replied, or been marked lost. n8n does the
 * same thing for the same reason.
 *
 * `already_a_patient` is the case that matters most and the one a stage check
 * alone misses: somebody can be booked in at the desk without anybody
 * touching the lead card, so the lead still says 'new' while the person is
 * sitting in the waiting room. Matching on phone and email is the same check
 * /api/public/v1/patients/lookup does, and it tolerates a number typed
 * differently.
 */
export async function sequenceStopReason(
  supabase: any,
  accountId: string,
  lead: { id: string; stage: string; patient_id: string | null; deleted_at: string | null; phone: string | null; email: string | null },
): Promise<SequenceVerdict> {
  if (lead.deleted_at) return 'lead_deleted'
  if (lead.stage === 'converted' || lead.patient_id) return 'converted'
  if (lead.stage === 'lost') return 'lost'
  if (!lead.phone && !lead.email) return 'no_contact'

  if (lead.email) {
    const { data } = await supabase.from('patients').select('id').eq('account_id', accountId).ilike('email', lead.email).limit(1)
    if ((data ?? []).length > 0) return 'already_a_patient'
  }

  if (lead.phone) {
    const digits = lead.phone.replace(/\D/g, '')
    const { data: numbers } = await supabase
      .from('patient_contact_numbers')
      .select('number, country_code')
      .eq('account_id', accountId)
    for (const n of numbers ?? []) {
      if (phoneMatches(n.number, n.country_code, digits)) return 'already_a_patient'
    }
  }

  return practiceHubVerdict(supabase, accountId, lead)
}

/** How long to wait on PracticeHub before treating it as unreachable. */
const PRACTICEHUB_TIMEOUT_MS = 5000

/**
 * Small, but more than one. If `email` really does filter, one row is all
 * there is; if it does not, a handful of rows costs nothing and still will
 * not match. Deliberately not a full scan -- this runs per lead per tick.
 */
const PRACTICEHUB_PAGE_SIZE = '25'

/**
 * Asks PracticeHub whether this person is already a patient there.
 *
 * n8n asks the same question for the same reason: the two systems are
 * dual-running, so somebody booked in PracticeHub is converted even though
 * nothing in QuiroFlow knows it. Without this the drip keeps chasing them.
 */
async function practiceHubVerdict(
  supabase: any,
  accountId: string,
  lead: { email: string | null; phone: string | null },
): Promise<SequenceVerdict> {
  const { data: account } = await supabase
    .from('accounts')
    .select('practicehub_base_url, practicehub_api_key, practicehub_contact_email')
    .eq('id', accountId)
    .maybeSingle()

  const baseUrl: string | undefined = account?.practicehub_base_url ?? undefined
  const apiKey: string | undefined = account?.practicehub_api_key ?? undefined
  // Not configured is not the same as unreachable. A clinic that never used
  // PracticeHub must not have its drips deferred forever waiting for an
  // answer nobody can give.
  if (!baseUrl || !apiKey) return null
  if (!lead.email) return null

  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/patients`)
  url.searchParams.set('email', lead.email)
  url.searchParams.set('page_size', PRACTICEHUB_PAGE_SIZE)

  try {
    const result = await $fetch<{ total_entries?: number; data?: Array<{ email?: string | null }> }>(url.toString(), {
      headers: {
        'x-practicehub-key': apiKey,
        // Same shape the importers send -- see usePracticeHubConnection.
        'x-app-details': `QuiroFlow=${account?.practicehub_contact_email ?? ''}`,
      },
      timeout: PRACTICEHUB_TIMEOUT_MS,
    })

    // Require a row whose email actually matches, rather than trusting
    // total_entries.
    //
    // total_entries answers "how many rows does this query have", which is
    // only the question we meant if PracticeHub applies `email` as a filter.
    // Nothing in this codebase establishes that it does -- every other caller
    // walks /patients unfiltered (usePracticeHubApi) -- and an API that
    // ignores an unknown query param returns the whole patient list with a
    // total in the thousands. That reads as "> 0" for everybody.
    //
    // It is not a theoretical worry: on 15 Sep the first three real Facebook
    // leads were all stopped here as already_a_patient, and none of the three
    // matched any patient in QuiroFlow by email or phone. Comparing the
    // returned email is right either way -- if the filter works this is the
    // same answer one step more carefully, and if it does not, an arbitrary
    // patient's address will not match the lead's.
    //
    // The residual error is a false NEGATIVE: a genuine PracticeHub patient
    // sitting beyond the first page when the filter is ignored. That keeps a
    // converted person in the drip, which is the lesser mistake and is what
    // n8n does today anyway -- its own check asks QuiroFlow's
    // /api/public/v1/patients/lookup and never consults PracticeHub.
    const rows = result?.data ?? []
    const wanted = lead.email.trim().toLowerCase()
    const matched = rows.some((row) => (row?.email ?? '').trim().toLowerCase() === wanted)

    if (!matched && (result?.total_entries ?? 0) > 0) {
      console.warn(
        `[leadSequences] PracticeHub returned ${result?.total_entries} row(s) for ${wanted} but none matched; treating as not converted.`,
      )
    }
    return matched ? 'already_a_patient' : null
  } catch (err) {
    console.error('[leadSequences] PracticeHub unreachable, deferring:', (err as Error)?.message ?? err)
    return 'defer'
  }
}

export function delayMinutes(config: Record<string, any>) {
  const raw = Number(config?.delay_minutes)
  if (!Number.isFinite(raw) || raw <= 0) return SEQUENCE_TICK_MINUTES
  return Math.max(raw, SEQUENCE_TICK_MINUTES)
}

/**
 * How many times a failing step is tried before the run is parked as
 * 'failed'. The first attempt plus two retries, one tick apart: enough to
 * ride out a Meta or webhook blip, few enough that a real problem is on the
 * Executions tab within the hour rather than retried all week.
 */
export const MAX_STEP_ATTEMPTS = 3

/** The plain-language reason a run stopped, as the Executions tab shows it. */
export const STOP_REASON_TEXT: Record<StopReason, string> = {
  converted: 'Became a patient',
  already_a_patient: 'Already a patient (matched by phone or email)',
  lead_deleted: 'Lead was deleted',
  lost: 'Lead was marked lost',
  no_contact: 'Lead has no phone or email',
  rule_shortened: 'The automation was shortened past where this lead was',
  not_entitled: 'Growth is no longer on the subscription',
  patient_deleted: 'Patient was deleted',
  exited: 'Left the automation when an exit event happened',
}

/** What a step is called in the history, copied at the time it ran. */
export function stepLabel(action: { action_type: string; config: Record<string, any> }) {
  if (action.action_type === 'delay') {
    const minutes = delayMinutes(action.config)
    if (minutes % 1440 === 0) return `Wait ${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
    if (minutes % 60 === 0) return `Wait ${minutes / 60} hour${minutes === 60 ? '' : 's'}`
    return `Wait ${minutes} min`
  }
  if (action.action_type === 'email') return `Email · ${action.config?.subject || 'no subject'}`
  if (action.action_type === 'webhook') return `Webhook · ${action.config?.url || 'no URL'}`
  if (action.action_type === 'branch') return 'Branch'
  if (action.action_type === 'wait_until') return `Wait for ${action.config?.event || 'an event'}`
  if (action.action_type === 'tag') return `${action.config?.mode === 'remove' ? 'Remove tag' : 'Add tag'} · ${action.config?.tag || 'no tag'}`
  if (action.action_type === 'notify') return `Notify · ${action.config?.title || 'team'}`
  if (action.action_type === 'lead_stage') return `Move lead · ${action.config?.stage || 'no stage'}`
  if (action.action_type === 'lead_assign') return 'Assign lead'
  return `WhatsApp · ${action.config?.template_name || 'no template'}`
}

export type RunEvent = {
  outcome:
    | 'started'
    | 'sent'
    | 'dry_run'
    | 'skipped'
    | 'failed'
    | 'waiting'
    | 'deferred'
    | 'stopped'
    | 'finished'
    | 'retried'
    | 'branched'
    | 'met'
    | 'timed_out'
    | 'applied'
  position?: number | null
  action?: { action_type: string; config: Record<string, any> } | null
  detail?: string | null
  actorTeamMemberId?: string | null
}

/**
 * Appends to the run's history. Best-effort by design: the history describes
 * the drip, it must never be the reason a message is not sent or a run is not
 * advanced -- so a failed insert is logged and swallowed.
 */
export async function logRunEvent(supabase: any, run: { id: string; account_id: string }, event: RunEvent) {
  const { error } = await supabase.from('automation_run_events').insert({
    account_id: run.account_id,
    run_id: run.id,
    position: event.position ?? null,
    action_type: event.action?.action_type ?? null,
    step_label: event.action ? stepLabel(event.action) : null,
    outcome: event.outcome,
    detail: event.detail ?? null,
    actor_team_member_id: event.actorTeamMemberId ?? null,
  })
  if (error) console.error('[leadSequences] could not record run event:', error.message)
}

/** Ends a run early, with the reason in words on its history. */
export async function stopRun(supabase: any, run: { id: string; account_id: string }, reason: StopReason, detail?: string) {
  await supabase.from('automation_sequence_runs').update({ status: 'cancelled', stopped_reason: reason }).eq('id', run.id)
  await logRunEvent(supabase, run, { outcome: 'stopped', detail: detail ?? STOP_REASON_TEXT[reason] })
}
