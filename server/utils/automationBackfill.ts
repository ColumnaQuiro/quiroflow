import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { startPatientRun } from '~/server/utils/automationEngine'
import { CREATED_MOMENTS } from '~/server/utils/automationAtomRules'
import { mapWithConcurrency } from '~/server/utils/concurrency'
import { RECALL_QUEUE_COLUMNS, withoutParkedRecalls } from '~/server/utils/segmentAudience'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { respectsRecallQueue, type RecallQueueState } from '~/utils/automationAudience'
import { BACKFILL_MAX_PATIENTS, backfillKindOf, type BackfillKind } from '~/utils/automationBackfill'
import { eventDelayMinutes, type TriggerAtom } from '~/utils/automationTrigger'
import { shiftDate, triggerDocMatches } from '~/utils/automationTriggerMatch'
import { DEFAULT_CLINIC_TIMEZONE, startOfLocalDate } from '~/utils/clinicClock'
import { localParts } from '~/utils/automationTiming'

// "Also everyone who already meets it": the one-off pass an automation can
// make as it is switched on (utils/automationBackfill.ts says which triggers
// can). It enrols the people the automation would have taken in had it been
// on for the last N days, and from then on the usual path takes over.
//
// Who it reaches is held to what a bulk enrolment holds anyone to -- the
// group send and "enters a list" (automationEngine.enrolDueSegments,
// automationTriggers.enrolAudienceEntries): an active record, not a minor,
// not "do not contact", and a marketing channel accepted for a marketing
// automation; the Recalls queue's parked patients are left out of a recall.
// Consent per channel is asked again at every send, as always.
//
// Nobody twice, three ways:
//  - each source (the missed visit, the new patient, the completed form) is
//    claimed before its run starts, in the table the live check claims it in
//    when it has one -- automation_trigger_claims for the rows the atoms add,
//    automation_doc_sends for a completed form -- so the 15-minute check
//    never takes the same row again, and a second pass (a double click, a
//    second switch-on) finds it taken. Sources the live path never looks
//    back at (a status the visit already has, a last visit whose day has
//    gone) are claimed under occurrence 'backfill';
//  - one entry per person, from their most recent source;
//  - nobody this automation has already reached: a run of it, or a message
//    it sent (test-mode records do not count -- they reached nobody).
//
// Runs are created due but not walked (`advance: false`), as the group send
// does: the minute tick walks them a hundred at a time, so a pass never
// messages a whole clinic from inside one request. Their emails count as
// campaign email (context.backfill, automationEngine's email scope).

const CHUNK = 200
const FILTER_CONCURRENCY = 8

export interface BackfillRule {
  /** Null for an automation not saved yet: a preview with nobody to dedupe against. */
  id: string | null
  account_id: string
  atom: TriggerAtom
  filters: Record<string, unknown> | null
  is_marketing?: boolean | null
}

interface Source {
  sourceId: string
  patientId: string
  /** When the trigger's moment happened: the start of a run held back by its timing counts from here. */
  at: string
  appointmentId?: string
  invoiceId?: string
}

export interface BackfillCandidate extends Source {
  triggerEvent: string
}

interface ClaimTable {
  table: 'automation_trigger_claims' | 'automation_doc_sends'
  column: 'source_id' | 'doc_id'
  occurrence?: string
}

function claimTableOf(kind: BackfillKind): ClaimTable {
  if (kind === 'doc') return { table: 'automation_doc_sends', column: 'doc_id' }
  // The live check claims new rows with occurrence ''; sharing it is what
  // keeps the two from both taking a row made in the last two days.
  if (kind === 'created') return { table: 'automation_trigger_claims', column: 'source_id', occurrence: '' }
  return { table: 'automation_trigger_claims', column: 'source_id', occurrence: 'backfill' }
}

function triggerEventOf(kind: BackfillKind, atom: TriggerAtom): string {
  if (kind === 'doc') return 'doc.completed'
  if (kind === 'last_visit') return 'patient.date'
  return `${atom.subject}.${atom.moment}`
}

async function clinicTz(service: any, accountId: string): Promise<string> {
  const { data } = await service.from('clinics').select('timezone').eq('account_id', accountId).is('archived_at', null).order('created_at').limit(1).maybeSingle()
  return data?.timezone || DEFAULT_CLINIC_TIMEZONE
}

/** Every source of the trigger in the window, the most recent first. */
async function sourcesOf(service: any, kind: BackfillKind, rule: BackfillRule, days: number, now: Date, tz: string): Promise<Source[]> {
  const accountId = rule.account_id
  const nowIso = now.toISOString()
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString()

  if (kind === 'appointment') {
    // Dated by the visit's own time: an appointment keeps no record of when
    // it was cancelled or marked missed. A cancelled visit still ahead is
    // not in the window; nor is a missed one, which cannot be ahead.
    const rows = await fetchAllRows<{ id: string; patient_id: string; starts_at: string }>((from, to) =>
      service
        .from('appointments')
        .select('id, patient_id, starts_at')
        .eq('account_id', accountId)
        .eq('status', rule.atom.moment)
        // A deleted appointment keeps its status; only deleted_at says so.
        .is('deleted_at', null)
        .not('patient_id', 'is', null)
        .gte('starts_at', since)
        .lte('starts_at', nowIso)
        .order('starts_at', { ascending: false })
        .order('id')
        .range(from, to),
    )
    return rows.map((a) => ({ sourceId: a.id, patientId: a.patient_id, at: a.starts_at, appointmentId: a.id }))
  }

  if (kind === 'created') {
    const def = CREATED_MOMENTS.find((k) => k.subject === rule.atom.subject && k.moment === rule.atom.moment)
    if (!def) return []
    const columns = ['id', def.patient === 'id' ? null : def.patient, def.at, def.columns ?? null].filter(Boolean).join(', ')
    const rows = await fetchAllRows<Record<string, any>>((from, to) => {
      let q = service.from(def.table).select(columns).eq('account_id', accountId).gte(def.at, since).lte(def.at, nowIso)
      if (def.narrow) q = def.narrow(q)
      return q.order(def.at, { ascending: false }).order('id').range(from, to)
    })
    const asRule = { ...rule, id: rule.id ?? '', trigger_event: '', created_at: nowIso }
    return rows
      .filter((row) => row[def.patient] && (!def.takes || def.takes(asRule, row)))
      .map((row) => ({ sourceId: row.id, patientId: row[def.patient], at: row[def.at], ...(def.subject === 'invoice' ? { invoiceId: row.id } : {}) }))
  }

  if (kind === 'doc') {
    const rows = await fetchAllRows<{ id: string; patient_id: string; template_id: string | null; completed_at: string }>((from, to) =>
      service
        .from('patient_docs')
        .select('id, patient_id, template_id, completed_at')
        .eq('account_id', accountId)
        .gte('completed_at', since)
        .lte('completed_at', nowIso)
        .order('completed_at', { ascending: false })
        .order('id')
        .range(from, to),
    )
    return rows.filter((d) => d.patient_id && triggerDocMatches(rule.atom.options, d.template_id)).map((d) => ({ sourceId: d.id, patientId: d.patient_id, at: d.completed_at }))
  }

  // last_visit: "not been back for N days". The live check takes, each
  // day, the visits of exactly N days ago that are still the last; the pass
  // takes those whose Nth day fell inside the window and has gone -- today's
  // is the live check's. So: last completed visit on a day in
  // [today - N - days, today - N), and none since.
  const n = rule.atom.timing!.amount
  const today = localParts(now, tz).date
  const rangeStart = startOfLocalDate(shiftDate(today, -n - days), tz).toISOString()
  const rangeEnd = startOfLocalDate(shiftDate(today, -n), tz).getTime()
  const visits = await fetchAllRows<{ id: string; patient_id: string; starts_at: string }>((from, to) =>
    service
      .from('appointments')
      .select('id, patient_id, starts_at')
      .eq('account_id', accountId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .not('patient_id', 'is', null)
      .gte('starts_at', rangeStart)
      .lte('starts_at', nowIso)
      .order('starts_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  const latest = new Map<string, { id: string; starts_at: string }>()
  for (const v of visits) if (!latest.has(v.patient_id)) latest.set(v.patient_id, v)
  return [...latest]
    .filter(([, v]) => Date.parse(v.starts_at) < rangeEnd)
    .map(([patientId, v]) => ({ sourceId: v.id, patientId, at: v.starts_at, appointmentId: v.id }))
}

/** The sources a claim already took, out of these. */
async function unclaimed(service: any, ruleId: string, claim: ClaimTable, sources: Source[]): Promise<Source[]> {
  const taken = new Set<string>()
  const ids = [...new Set(sources.map((s) => s.sourceId))]
  for (let i = 0; i < ids.length; i += CHUNK) {
    let q = service.from(claim.table).select(claim.column).eq('rule_id', ruleId).in(claim.column, ids.slice(i, i + CHUNK))
    if (claim.occurrence !== undefined) q = q.eq('occurrence', claim.occurrence)
    const { data, error } = await q
    if (error) throw error
    for (const r of (data ?? []) as Record<string, string>[]) taken.add(r[claim.column]!)
  }
  return sources.filter((s) => !taken.has(s.sourceId))
}

/** Of these patients, the ones this automation has already reached: a run of it, or a real message it sent. */
async function alreadyReached(service: any, ruleId: string, patientIds: string[]): Promise<Set<string>> {
  const reached = new Set<string>()
  for (let i = 0; i < patientIds.length; i += CHUNK) {
    const chunk = patientIds.slice(i, i + CHUNK)
    const [runs, whatsapp, email] = await Promise.all([
      service.from('automation_sequence_runs').select('patient_id').eq('rule_id', ruleId).in('patient_id', chunk),
      service.from('whatsapp_messages').select('patient_id').eq('rule_id', ruleId).neq('status', 'would_send').in('patient_id', chunk),
      service.from('email_messages').select('patient_id').eq('rule_id', ruleId).eq('dry_run', false).in('patient_id', chunk),
    ])
    for (const res of [runs, whatsapp, email]) {
      if (res.error) throw res.error
      for (const r of (res.data ?? []) as { patient_id: string | null }[]) if (r.patient_id) reached.add(r.patient_id)
    }
  }
  return reached
}

type Gated = RecallQueueState & { id: string; status: string | null; is_minor: boolean; do_not_contact: boolean; marketing_channels: string[] | null }

/** The patients a bulk enrolment may reach (see the top of this file). */
async function passGates(service: any, rule: BackfillRule, patientIds: string[], kind: BackfillKind, now: Date, tz: string): Promise<Set<string>> {
  let ok: Gated[] = []
  for (let i = 0; i < patientIds.length; i += CHUNK) {
    const { data, error } = await service
      .from('patients')
      .select(`id, status, is_minor, do_not_contact, marketing_channels, ${RECALL_QUEUE_COLUMNS}`)
      .eq('account_id', rule.account_id)
      .in('id', patientIds.slice(i, i + CHUNK))
    if (error) throw error
    ok.push(...((data ?? []) as Gated[]).filter((p) => p.status !== 'inactive' && !p.is_minor && !p.do_not_contact && (!rule.is_marketing || (p.marketing_channels ?? []).length > 0)))
  }
  if (kind === 'last_visit' && ok.length && respectsRecallQueue(rule.filters as never, Boolean(rule.is_marketing))) {
    ok = await withoutParkedRecalls(service, rule.account_id, ok, localParts(now, tz).date)
  }
  return new Set(ok.map((p) => p.id))
}

/**
 * Who a pass over the last `days` days would enrol, the most recent first,
 * at most BACKFILL_MAX_PATIENTS of them; `more` when there were others past
 * that. The same list the activation dialog counts and the pass enrols.
 */
export async function backfillCandidates(service: any, rule: BackfillRule, days: number, now = new Date()): Promise<{ candidates: BackfillCandidate[]; more: boolean }> {
  const kind = backfillKindOf(rule.atom)
  if (!kind) return { candidates: [], more: false }
  const tz = await clinicTz(service, rule.account_id)

  let sources = await sourcesOf(service, kind, rule, days, now, tz)
  if (rule.id) sources = await unclaimed(service, rule.id, claimTableOf(kind), sources)

  // One entry per person: their most recent source (sources come newest first).
  const byPatient = new Map<string, Source>()
  for (const s of sources) if (!byPatient.has(s.patientId)) byPatient.set(s.patientId, s)
  let ids = [...byPatient.keys()]
  if (!ids.length) return { candidates: [], more: false }

  if (rule.id) {
    const reached = await alreadyReached(service, rule.id, ids)
    ids = ids.filter((id) => !reached.has(id))
  }
  const allowed = await passGates(service, rule, ids, kind, now, tz)
  ids = ids.filter((id) => allowed.has(id))

  // The rule's "only if", asked now -- as the live path asks it when the
  // moment happens -- a handful at a time, stopping once the cap is passed.
  const triggerEvent = triggerEventOf(kind, rule.atom)
  const out: BackfillCandidate[] = []
  for (let i = 0; i < ids.length && out.length <= BACKFILL_MAX_PATIENTS; i += FILTER_CONCURRENCY * 4) {
    const chunk = ids.slice(i, i + FILTER_CONCURRENCY * 4).map((id) => byPatient.get(id)!)
    const matched = await mapWithConcurrency(chunk, FILTER_CONCURRENCY, (s) => ruleFiltersMatch(service, s.patientId, rule.filters as AutomationFilters, s.appointmentId))
    chunk.forEach((s, j) => {
      if (matched[j]) out.push({ ...s, triggerEvent })
    })
  }
  return { candidates: out.slice(0, BACKFILL_MAX_PATIENTS), more: out.length > BACKFILL_MAX_PATIENTS }
}

/**
 * The pass itself, for a saved automation that is switched on. Returns how
 * many it enrolled; a second pass over the same window enrols nobody again.
 */
export async function runBackfill(service: any, rule: BackfillRule & { id: string }, days: number, origin: string, requestedBy: string | null, now = new Date()): Promise<{ enrolled: number; more: boolean }> {
  const kind = backfillKindOf(rule.atom)
  if (!kind) return { enrolled: 0, more: false }
  const { candidates, more } = await backfillCandidates(service, rule, days, now)
  const claim = claimTableOf(kind)
  // A trigger that holds its moment back ("2 days after a missed visit")
  // starts each run when that time comes, or now if it has passed; one still
  // ahead asks the filters again then, as the live path does.
  const delayMs = eventDelayMinutes(rule.atom) * 60_000

  const flags = await mapWithConcurrency(candidates, 5, async (c) => {
    const row: Record<string, unknown> = { rule_id: rule.id, [claim.column]: c.sourceId, account_id: rule.account_id }
    if (claim.occurrence !== undefined) row.occurrence = claim.occurrence
    // Claimed first: a second pass running at the same time loses here.
    const { error: claimError } = await service.from(claim.table).insert(row)
    if (claimError) return false
    const dueAt = Date.parse(c.at) + delayMs
    const held = dueAt > now.getTime()
    const runId = await startPatientRun(service, {
      accountId: rule.account_id,
      ruleId: rule.id,
      patientId: c.patientId,
      origin,
      appointmentId: c.appointmentId,
      triggerBody: { triggerEvent: c.triggerEvent, patientId: c.patientId, ...(c.appointmentId ? { appointmentId: c.appointmentId } : {}), ...(c.invoiceId ? { invoiceId: c.invoiceId } : {}) },
      advance: false,
      backfill: { by: requestedBy },
      ...(held ? { resumeAt: new Date(dueAt).toISOString(), recheckFilters: true } : {}),
    })
    return Boolean(runId)
  })
  return { enrolled: flags.filter(Boolean).length, more }
}
