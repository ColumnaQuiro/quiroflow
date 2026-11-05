import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule, startLeadSequence, startPatientRun } from '~/server/utils/automationEngine'
import { audienceEntriesSince, audienceMembersNow } from '~/server/utils/audienceMembers'
import { asAudienceRef } from '~/utils/automationAudience'
import { triggerBonoMatches, triggerCarePlanMatches, triggerDocMatches, triggerStageMatches } from '~/utils/automationTriggerMatch'
import type { CarePlanVisitMarker } from '~/utils/carePlanVisitMarkers'
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
      const since = scanSince(rule)
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

type ScanRule = { id: string; account_id: string; filters: Record<string, unknown> | null; created_at: string }

/** Where a scan starts for a rule: two days back at most, and not before the rule existed (less a minute for clocks). */
function scanSince(rule: ScanRule): string {
  return new Date(Math.max(Date.now() - DOC_LOOKBACK_MS, new Date(rule.created_at).getTime() - 60_000)).toISOString()
}

/**
 * "Care plan milestone": visits completed since the rule last looked, each
 * numbered within the patient's latest care plan the way the plan's own
 * screen numbers them (care_plan_marked_visits: the Nth appointment since the
 * plan started, not cancelled, missed or deleted). That function answers
 * only to a signed-in member, so the numbering is repeated here for the tick.
 *
 * automation_rule_sends is the claim, one per (rule, visit), as the review
 * and satisfaction triggers use it.
 */
export async function enrolCarePlanMilestones(service: any, origin: string): Promise<number> {
  const { data: rules } = await service.from('automation_rules').select('id, account_id, filters, created_at').eq('trigger_event', 'care_plan.milestone').eq('enabled', true)
  let fired = 0
  for (const rule of (rules ?? []) as ScanRule[]) {
    try {
      const { data: visits } = await service
        .from('appointments')
        .select('id, patient_id, starts_at')
        .eq('account_id', rule.account_id)
        .eq('status', 'completed')
        .is('deleted_at', null)
        .gte('starts_at', scanSince(rule))
        .lte('starts_at', new Date().toISOString())
        .order('starts_at')
        .limit(DOCS_PER_TICK)
      const list = (visits ?? []) as { id: string; patient_id: string; starts_at: string }[]
      if (!list.length) continue
      const { data: done } = await service.from('automation_rule_sends').select('appointment_id').eq('rule_id', rule.id).in('appointment_id', list.map((v) => v.id))
      const seen = new Set(((done ?? []) as { appointment_id: string }[]).map((d) => d.appointment_id))
      for (const visit of list) {
        if (seen.has(visit.id)) continue
        const { data: plan } = await service
          .from('care_plans')
          .select('id, started_at, total_visits, visit_markers')
          .eq('account_id', rule.account_id)
          .eq('patient_id', visit.patient_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!plan || `${plan.started_at}T00:00:00Z` > visit.starts_at) continue
        const { data: counted } = await service
          .from('appointments')
          .select('id, starts_at')
          .eq('patient_id', visit.patient_id)
          .is('deleted_at', null)
          .not('status', 'in', '(cancelled,no_show)')
          .gte('starts_at', `${plan.started_at}T00:00:00Z`)
          .lte('starts_at', visit.starts_at)
          .order('starts_at')
          .order('id')
        const k = ((counted ?? []) as { id: string }[]).findIndex((a) => a.id === visit.id) + 1
        if (k < 1) continue
        if (!triggerCarePlanMatches(rule.filters, k, { total_visits: plan.total_visits, markers: (plan.visit_markers ?? []) as CarePlanVisitMarker[] })) continue
        const { error: claimError } = await service.from('automation_rule_sends').insert({ rule_id: rule.id, appointment_id: visit.id })
        if (claimError) continue
        const { data: patient } = await service.from('patients').select(PATIENT_FOR_RULE_COLUMNS).eq('id', visit.patient_id).maybeSingle()
        if (!patient || !(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters, visit.id))) continue
        await dispatchPatientRule(service, service, rule.account_id, rule.id, patient, origin, visit.id, { triggerEvent: 'care_plan.milestone', patientId: patient.id, appointmentId: visit.id })
        fired += 1
      }
    } catch (err) {
      console.error(`[automations] care_plan.milestone scan failed for rule ${rule.id}:`, (err as Error)?.message ?? err)
    }
  }
  return fired
}

/**
 * "Bono running low": bonos a session was used from since the rule last
 * looked, now with no more than the rule's number of sessions left. Used
 * sessions are read off package_sessions, leaving out imported ones (an
 * external_reference): a PracticeHub re-run is history, not a visit today.
 * automation_bono_sends claims each (rule, bono) once.
 */
export async function enrolBonosRunningLow(service: any, origin: string): Promise<number> {
  const { data: rules } = await service.from('automation_rules').select('id, account_id, filters, created_at').eq('trigger_event', 'bono.running_low').eq('enabled', true)
  let fired = 0
  for (const rule of (rules ?? []) as ScanRule[]) {
    try {
      const { data: used } = await service
        .from('package_sessions')
        .select('package_purchase_id')
        .eq('account_id', rule.account_id)
        .is('external_reference', null)
        .not('package_purchase_id', 'is', null)
        .gte('created_at', scanSince(rule))
        .limit(DOCS_PER_TICK)
      const ids = [...new Set(((used ?? []) as { package_purchase_id: string }[]).map((u) => u.package_purchase_id))]
      if (!ids.length) continue
      const { data: bonos } = await service.from('package_purchases').select('id, patient_id, sessions_total, sessions_used, is_closed').in('id', ids)
      const { data: done } = await service.from('automation_bono_sends').select('purchase_id').eq('rule_id', rule.id).in('purchase_id', ids)
      const seen = new Set(((done ?? []) as { purchase_id: string }[]).map((d) => d.purchase_id))
      for (const bono of (bonos ?? []) as { id: string; patient_id: string; sessions_total: number; sessions_used: number; is_closed: boolean | null }[]) {
        if (seen.has(bono.id) || bono.is_closed) continue
        const left = Math.max(0, bono.sessions_total - bono.sessions_used)
        if (!triggerBonoMatches(rule.filters, left)) continue
        const { error: claimError } = await service.from('automation_bono_sends').insert({ rule_id: rule.id, purchase_id: bono.id, account_id: rule.account_id })
        if (claimError) continue
        const { data: patient } = await service.from('patients').select(PATIENT_FOR_RULE_COLUMNS).eq('id', bono.patient_id).maybeSingle()
        if (!patient || !(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters))) continue
        await dispatchPatientRule(service, service, rule.account_id, rule.id, patient, origin, undefined, { triggerEvent: 'bono.running_low', patientId: patient.id })
        fired += 1
      }
    } catch (err) {
      console.error(`[automations] bono.running_low scan failed for rule ${rule.id}:`, (err as Error)?.message ?? err)
    }
  }
  return fired
}

/**
 * The later of a cursor and an entry, keeping the database's own string: it
 * carries microseconds, and a cursor rounded to milliseconds would sit just
 * before the entry it came from and read it again next tick.
 */
function latest(max: string, e: { entered_at: string }): string {
  return Date.parse(e.entered_at) >= Date.parse(max) ? e.entered_at : max
}

/**
 * "Enters a list or segment": whoever came into the rule's audience since its
 * cursor (automation_rules.segment_last_run_at, which this trigger borrows
 * from the group send), read with audience_entries_since. A list entry is
 * the moment someone was added; a segment's is the snapshot that first saw
 * them match, so a segment entry can be up to 15 minutes late.
 *
 * The first tick after a rule is switched on only sets the cursor -- the
 * people already in it are not news -- unless the rule says to include them
 * (filters.include_current), when they are enrolled once, then. The cursor is
 * claimed before anyone is enrolled, so two ticks cannot both enrol an entry.
 * Runs are created due and walked by the same tick, as the group send does.
 */
export async function enrolAudienceEntries(service: any, origin: string): Promise<number> {
  const { data: rules } = await service
    .from('automation_rules')
    .select('id, account_id, filters, is_marketing, segment_last_run_at')
    .eq('trigger_event', 'audience.entered')
    .eq('enabled', true)
  let enrolled = 0
  for (const rule of (rules ?? []) as { id: string; account_id: string; filters: Record<string, unknown> | null; is_marketing: boolean; segment_last_run_at: string | null }[]) {
    try {
      const audience = asAudienceRef(rule.filters?.trigger_audience)
      if (!audience) continue
      const first = !rule.segment_last_run_at
      let entries: { patient_id: string; entered_at: string }[]
      let cursor: string
      if (first) {
        // Where counting starts is the newest current member's own stamp --
        // the database's clock, which entries are compared with -- or, for an
        // empty audience, a minute back, so nobody added while the rule was
        // being switched on falls between two clocks.
        const current = await audienceMembersNow(service, audience)
        entries = rule.filters?.include_current === true ? current : []
        cursor = current.reduce(latest, new Date(Date.now() - 60_000).toISOString())
      } else {
        entries = await audienceEntriesSince(service, audience, rule.segment_last_run_at!)
        if (!entries.length) continue
        cursor = entries.reduce(latest, rule.segment_last_run_at!)
      }

      let claim = service.from('automation_rules').update({ segment_last_run_at: cursor }).eq('id', rule.id)
      claim = first ? claim.is('segment_last_run_at', null) : claim.eq('segment_last_run_at', rule.segment_last_run_at)
      const { data: claimed } = await claim.select('id').maybeSingle()
      if (!claimed || !entries.length) continue

      // The account's own patients only, through the gates every audience
      // has: not archived, not a minor, not do-not-contact, and a marketing
      // channel for a marketing rule. Consent per channel is checked again
      // at every send.
      const ids = [...new Set(entries.map((e) => e.patient_id))]
      for (let i = 0; i < ids.length; i += 200) {
        const { data: patients } = await service
          .from('patients')
          .select('id, is_minor, do_not_contact, marketing_channels')
          .eq('account_id', rule.account_id)
          .neq('status', 'inactive')
          .in('id', ids.slice(i, i + 200))
        for (const p of (patients ?? []) as { id: string; is_minor: boolean; do_not_contact: boolean; marketing_channels: string[] | null }[]) {
          if (p.is_minor || p.do_not_contact || (rule.is_marketing && !(p.marketing_channels ?? []).length)) continue
          if (!(await ruleFiltersMatch(service, p.id, rule.filters as AutomationFilters))) continue
          const runId = await startPatientRun(service, { accountId: rule.account_id, ruleId: rule.id, patientId: p.id, origin, triggerBody: { triggerEvent: 'audience.entered', patientId: p.id }, advance: false })
          if (runId) enrolled += 1
        }
      }
    } catch (err) {
      console.error(`[automations] audience.entered failed for rule ${rule.id}:`, (err as Error)?.message ?? err)
    }
  }
  return enrolled
}
