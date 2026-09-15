import { phoneMatches } from '~/utils/phone'
import { runLeadRuleActions, type ActionRow as SenderAction, type LeadForAction } from '~/server/utils/runAutomationActions'

// A multi-step automation for a lead: send, wait, send again, and stop the
// moment it stops being appropriate.
//
// The engine everywhere else fires a rule and runs its actions straight
// through, which works because nothing waits. A welcome drip waits days, so
// where each lead has got to is a row (automation_sequence_runs) and a cron
// picks up whatever is due.

/** The cron ticks every 15 minutes, so that is the real floor for any delay. */
export const SEQUENCE_TICK_MINUTES = 15

interface ActionRow extends SenderAction {
  position: number
}

interface SequenceRun {
  id: string
  account_id: string
  rule_id: string
  lead_id: string
  next_position: number
}

export type StopReason = 'converted' | 'already_a_patient' | 'lead_deleted' | 'lost' | 'no_contact' | 'rule_shortened'

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
): Promise<StopReason | null> {
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

  // Deliberately not checked here: PracticeHub. n8n asks it too, because the
  // two systems are still dual-running and somebody can exist there and not
  // here. Reaching it needs that integration's credentials on this path, so
  // until then a lead converted only in PracticeHub keeps receiving the
  // drip -- worth knowing, and worth closing before this replaces n8n
  // outright rather than running beside it.
  return null
}

function delayMinutes(config: Record<string, any>) {
  const raw = Number(config?.delay_minutes)
  if (!Number.isFinite(raw) || raw <= 0) return SEQUENCE_TICK_MINUTES
  return Math.max(raw, SEQUENCE_TICK_MINUTES)
}

async function stop(supabase: any, runId: string, reason: StopReason) {
  await supabase.from('automation_sequence_runs').update({ status: 'cancelled', stopped_reason: reason }).eq('id', runId)
}

/**
 * Runs a sequence from where it left off, until it hits a delay or the end.
 *
 * Actions are re-read every time rather than snapshotted at the start, so a
 * corrected typo reaches the people still mid-drip. The cost is that a
 * shortened sequence can leave a run pointing past the end, which is treated
 * as finished rather than as an error -- see 'rule_shortened'.
 */
export async function advanceSequenceRun(supabase: any, run: SequenceRun, origin: string) {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name, email, phone, stage, patient_id, deleted_at, marketing_consent_at')
    .eq('id', run.lead_id)
    .maybeSingle()

  if (!lead) return stop(supabase, run.id, 'lead_deleted')

  const reason = await sequenceStopReason(supabase, run.account_id, lead)
  if (reason) return stop(supabase, run.id, reason)

  const { data: actionRows } = await supabase
    .from('automation_actions')
    .select('id, action_type, position, config')
    .eq('rule_id', run.rule_id)
    .order('position')

  const actions = (actionRows ?? []) as ActionRow[]
  const remaining = actions.filter((a) => a.position >= run.next_position)

  if (remaining.length === 0) {
    const finishedNormally = actions.length > 0 && run.next_position > actions[actions.length - 1]!.position
    await supabase
      .from('automation_sequence_runs')
      .update(finishedNormally ? { status: 'done' } : { status: 'cancelled', stopped_reason: 'rule_shortened' })
      .eq('id', run.id)
    return
  }

  for (const action of remaining) {
    if (action.action_type === 'delay') {
      const resumeAt = new Date(Date.now() + delayMinutes(action.config) * 60_000).toISOString()
      await supabase
        .from('automation_sequence_runs')
        .update({ next_position: action.position + 1, resume_at: resumeAt })
        .eq('id', run.id)
      return
    }

    // One action at a time through the existing sender, so a lead gets the
    // same consent gate, the same template resolution and the same message
    // log a patient would.
    await runLeadRuleActions(supabase, run.account_id, run.rule_id, lead as LeadForAction, origin, undefined, [action])
  }

  await supabase
    .from('automation_sequence_runs')
    .update({ status: 'done', next_position: (actions[actions.length - 1]?.position ?? 0) + 1 })
    .eq('id', run.id)
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
    .select('id, account_id, rule_id, lead_id, next_position')
    .maybeSingle()

  // Null means the unique index refused it: this lead already has a run for
  // this rule, which is exactly the outcome we want.
  if (!run) return null

  await advanceSequenceRun(supabase, run as SequenceRun, origin)
  return run.id as string
}
