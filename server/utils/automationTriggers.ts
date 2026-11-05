import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule, startLeadSequence } from '~/server/utils/automationEngine'
import { triggerDocMatches, triggerStageMatches } from '~/utils/automationTriggerMatch'
import { LEAD_STOP_STAGES } from '~/utils/automationCatalog'

// Triggers raised on the server, for events that already happen there: a
// satisfaction answer, a tag an automation adds, a lead moved, a form found
// completed. The calendar's triggers come in through /api/automations/fire
// instead; both end in dispatchPatientRule, so a rule behaves the same
// whichever door it came through.
//
// Best-effort, like fire.post.ts: the action that raised the event already
// happened, and an automation that fails must not undo or block it.

/** The patient columns a rule's actions read -- the select fire.post.ts makes. */
export const PATIENT_FOR_RULE_COLUMNS =
  'id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact, preferred_language'

/**
 * Every enabled rule of the account on this event, whose own trigger setting
 * takes it (`matches`) and whose "only if" filters the patient passes.
 * `skipRuleId` keeps an automation from starting itself: a rule that adds a
 * tag and also starts on that tag would otherwise loop.
 */
export async function firePatientTrigger(
  service: any,
  accountId: string,
  patientId: string,
  event: string,
  origin: string,
  opts: { appointmentId?: string; matches?: (filters: Record<string, unknown>) => boolean; skipRuleId?: string } = {},
): Promise<number> {
  try {
    const { data: rules } = await service.from('automation_rules').select('id, filters').eq('account_id', accountId).eq('trigger_event', event).eq('enabled', true)
    const chosen = ((rules ?? []) as { id: string; filters: Record<string, unknown> | null }[]).filter((r) => r.id !== opts.skipRuleId && (!opts.matches || opts.matches(r.filters ?? {})))
    if (!chosen.length) return 0
    const { data: patient } = await service.from('patients').select(PATIENT_FOR_RULE_COLUMNS).eq('id', patientId).eq('account_id', accountId).maybeSingle()
    if (!patient) return 0
    let fired = 0
    for (const rule of chosen) {
      if (!(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters, opts.appointmentId))) continue
      await dispatchPatientRule(service, service, accountId, rule.id, patient, origin, opts.appointmentId, { triggerEvent: event, patientId, ...(opts.appointmentId ? { appointmentId: opts.appointmentId } : {}) })
      fired += 1
    }
    return fired
  } catch (err) {
    console.error(`[automations] ${event} failed to fire:`, (err as Error)?.message ?? err)
    return 0
  }
}

/**
 * A lead moved to `stage`, by someone on the team or by an automation step.
 * A lead enters each such automation once (the unique rule-lead index), as
 * with "New lead". A stage moved by the database on its own -- a booking
 * making it "Con cita" (lead_auto_stage) -- does not pass through here.
 */
export async function fireLeadStageTrigger(service: any, accountId: string, leadId: string, stage: string, origin: string, opts: { skipRuleId?: string } = {}): Promise<number> {
  // A lead converted or lost has its automations stopped by the engine; a
  // run started now would be cancelled before its first step.
  if (LEAD_STOP_STAGES.includes(stage)) return 0
  try {
    const { data: rules } = await service.from('automation_rules').select('id, filters').eq('account_id', accountId).eq('trigger_event', 'lead.stage_changed').eq('enabled', true)
    let fired = 0
    for (const rule of (rules ?? []) as { id: string; filters: Record<string, unknown> | null }[]) {
      if (rule.id === opts.skipRuleId || !triggerStageMatches(rule.filters, stage)) continue
      await startLeadSequence(service, accountId, rule.id, leadId, origin)
      fired += 1
    }
    return fired
  } catch (err) {
    console.error('[automations] lead.stage_changed failed to fire:', (err as Error)?.message ?? err)
    return 0
  }
}

/** How far back the first scan after a rule is switched on looks: forms completed before that are not news. */
const DOC_LOOKBACK_MS = 2 * 24 * 3600 * 1000
const DOCS_PER_TICK = 200

/**
 * "Form completed": the forms marked completed since the rule last looked,
 * found by the 15-minute tick rather than raised where they are completed --
 * that happens in a dozen places (the public link, the patient's record, the
 * reception tablet, the app, imports), and a scan cannot miss one of them.
 *
 * automation_doc_sends is the claim: one row per (rule, form), inserted before
 * the rule runs, so a form starts each automation once however many ticks see
 * it. Never further back than the rule's creation or two days, so switching a
 * rule on does not message everyone who ever signed a consent.
 */
export async function enrolCompletedDocs(service: any, origin: string): Promise<number> {
  const { data: rules } = await service.from('automation_rules').select('id, account_id, filters, created_at').eq('trigger_event', 'doc.completed').eq('enabled', true)
  let fired = 0
  for (const rule of (rules ?? []) as { id: string; account_id: string; filters: Record<string, unknown> | null; created_at: string }[]) {
    try {
      // A minute's grace before the rule's creation: completed_at can be
      // written by another machine's clock (a tablet, an import), and a form
      // completed while the rule was being saved should still count.
      const since = new Date(Math.max(Date.now() - DOC_LOOKBACK_MS, new Date(rule.created_at).getTime() - 60_000)).toISOString()
      const { data: docs } = await service
        .from('patient_docs')
        .select('id, patient_id, template_id, completed_at')
        .eq('account_id', rule.account_id)
        .gte('completed_at', since)
        .order('completed_at')
        .limit(DOCS_PER_TICK)
      const candidates = ((docs ?? []) as { id: string; patient_id: string; template_id: string | null }[]).filter((d) => triggerDocMatches(rule.filters, d.template_id))
      if (!candidates.length) continue
      const { data: done } = await service.from('automation_doc_sends').select('doc_id').eq('rule_id', rule.id).in('doc_id', candidates.map((d) => d.id))
      const seen = new Set(((done ?? []) as { doc_id: string }[]).map((d) => d.doc_id))
      for (const doc of candidates) {
        if (seen.has(doc.id)) continue
        // The claim first: a second tick running at the same time loses here.
        const { error: claimError } = await service.from('automation_doc_sends').insert({ rule_id: rule.id, doc_id: doc.id, account_id: rule.account_id })
        if (claimError) continue
        const { data: patient } = await service.from('patients').select(PATIENT_FOR_RULE_COLUMNS).eq('id', doc.patient_id).maybeSingle()
        if (!patient || !(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters))) continue
        await dispatchPatientRule(service, service, rule.account_id, rule.id, patient, origin, undefined, { triggerEvent: 'doc.completed', patientId: patient.id })
        fired += 1
      }
    } catch (err) {
      console.error(`[automations] doc.completed scan failed for rule ${rule.id}:`, (err as Error)?.message ?? err)
    }
  }
  return fired
}
