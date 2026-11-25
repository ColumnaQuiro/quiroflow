import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'
import { mapWithConcurrency } from '~/server/utils/concurrency'
import { atomOfRaisedEvent, isDateAtom, ruleAtom, timingMinutes, type TriggerAtom, type TriggerSubject } from '~/utils/automationTrigger'
import { shiftDate } from '~/utils/automationTriggerMatch'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, localDay, startOfLocalDate } from '~/utils/clinicClock'

// Finding the automations a moment starts, by their atom (utils/
// automationTrigger.ts): one lookup for every event the app raises, and the
// 15-minute checks for the moments nothing raises -- an appointment's start
// or end, and the rows the atoms added (a patient, a bono, an invoice, a
// form, a care plan, a waitlist entry).

/** The rule columns the triggers read. */
export const ATOM_RULE_COLUMNS = 'id, account_id, name, filters, trigger, trigger_event, created_at, is_marketing, segment_last_run_at'

/** The patient columns a rule's actions read -- the select fire.post.ts makes. */
export const PATIENT_FOR_RULE_COLUMNS =
  'id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact, preferred_language'

export interface AtomRule {
  id: string
  account_id: string
  name?: string | null
  filters: Record<string, unknown> | null
  trigger_event: string
  created_at: string
  is_marketing?: boolean | null
  segment_last_run_at?: string | null
  atom: TriggerAtom
}

/** Every enabled rule on a subject's moment, of one account or of all. */
export async function rulesOnMoment(client: any, subject: TriggerSubject | string, moment: string, opts: { accountId?: string; accountIds?: string[] } = {}): Promise<AtomRule[]> {
  let query = client.from('automation_rules').select(ATOM_RULE_COLUMNS).eq('enabled', true).eq('trigger->>subject', subject).eq('trigger->>moment', moment)
  if (opts.accountId) query = query.eq('account_id', opts.accountId)
  if (opts.accountIds) query = query.in('account_id', opts.accountIds)
  const { data, error } = await query
  if (error) console.error(`[automations] could not read the rules on ${subject}.${moment}:`, error.message)
  return ((data ?? []) as Omit<AtomRule, 'atom'>[]).map((r) => ({ ...r, atom: ruleAtom(r) }))
}

/**
 * The enabled rules of an account that an event raised by the app starts as
 * it happens (or held back by their timing): never a rule read by a date
 * check, and a referrer's rule only for the referrer's event.
 */
export async function rulesForRaisedEvent(client: any, accountId: string, event: string): Promise<AtomRule[]> {
  const raised = atomOfRaisedEvent(event)
  if (!raised) return []
  const rules = await rulesOnMoment(client, raised.subject, raised.moment, { accountId })
  return rules.filter((r) => !isDateAtom(r.atom) && (r.atom.send_to === 'referrer') === (raised.sendTo === 'referrer'))
}

// ------------------------------------------------------------------ appointment start / end

const WINDOW_BUFFER_MINUTES = 20
const SEND_CONCURRENCY = 5

/**
 * Which of the appointment checks a cron runs: each of the three endpoints
 * that used to run one old trigger runs its share, so the work and the
 * schedules in production stay as they were.
 *  - 'start':     N minutes/hours/days before or after the start (hours-before-cron)
 *  - 'start_day': N days before or after the start, at a time of day (same-day-cron)
 *  - 'end':       N after the end (review-request-cron)
 */
export type AppointmentCheck = 'start' | 'start_day' | 'end'

export function appointmentCheckOf(atom: TriggerAtom): AppointmentCheck | null {
  if (atom.subject !== 'appointment' || !atom.timing) return null
  if (atom.moment === 'end') return 'end'
  if (atom.moment === 'start') return atom.timing.at ? 'start_day' : 'start'
  return null
}

interface Due {
  rule: AtomRule
  appointmentId: string
  patientId: string
}

/**
 * The appointments whose start or end, moved by the rule's timing, falls in
 * this check's window -- the window the old triggers used (now to now + 20
 * minutes, on a 15-minute schedule, so a tick that runs a little late misses
 * nothing) -- or, for a time of day, the day it names, from that time for
 * twenty minutes in each clinic's own zone.
 *
 * Each (rule, appointment) once: automation_rule_sends, the table the old
 * hours-before, review and satisfaction triggers wrote, so a visit one of
 * them already messaged is not messaged again by the rule it became. The
 * morning-of message keeps the old same-day trigger's mark on the
 * appointment instead (same_day_info_sent_at): the calendar's history shows
 * it, an import sets it to keep old visits quiet, a visit already told that
 * morning is not told again -- and a visit moved to another day is told on
 * that day, which a claim per appointment would not allow.
 */
export async function enrolAppointmentMoments(service: any, origin: string, check: AppointmentCheck, now = new Date()): Promise<number> {
  const rules = (await rulesOnMoment(service, 'appointment', check === 'end' ? 'end' : 'start')).filter((r) => appointmentCheckOf(r.atom) === check)
  if (rules.length === 0) return 0

  const due: Due[] = []
  for (const rule of rules) {
    try {
      const found = check === 'start_day' ? await dayOfCandidates(service, rule, now) : await windowCandidates(service, rule, now)
      if (!found.length) continue
      const { data: sent } = isMorningOf(rule.atom)
        ? { data: [] }
        : await service.from('automation_rule_sends').select('appointment_id').eq('rule_id', rule.id).in('appointment_id', found.map((a) => a.id))
      const done = new Set(((sent ?? []) as { appointment_id: string }[]).map((s) => s.appointment_id))
      // "Not asked to rate recently" is about the person: two visits ending
      // in the same window ask once (the old satisfaction trigger's rule).
      const onePerPatient = typeof (rule.filters as AutomationFilters | null)?.not_rated_days === 'number'
      const taken = new Set<string>()
      for (const a of found) {
        if (done.has(a.id) || !a.patient_id) continue
        if (onePerPatient && taken.has(a.patient_id)) continue
        taken.add(a.patient_id)
        due.push({ rule, appointmentId: a.id, patientId: a.patient_id })
      }
    } catch (err) {
      console.error(`[automations] appointment ${check} check failed for rule ${rule.id}:`, (err as Error)?.message ?? err)
    }
  }
  if (due.length === 0) return 0

  const { data: patients } = await service.from('patients').select(PATIENT_FOR_RULE_COLUMNS).in('id', [...new Set(due.map((d) => d.patientId))])
  const byId = new Map(((patients ?? []) as { id: string }[]).map((p) => [p.id, p]))

  // Appointments told this morning by a day-of rule, marked once all their rules have run.
  const markSameDay = new Set<string>()
  const flags = await mapWithConcurrency(due, SEND_CONCURRENCY, async (d) => {
    const patient = byId.get(d.patientId)
    if (!patient) return false
    if (!(await ruleFiltersMatch(service, d.patientId, d.rule.filters as AutomationFilters, d.appointmentId))) return false
    // Claimed before anything is sent: two overlapping ticks cannot both send.
    if (!isMorningOf(d.rule.atom)) {
      const { error: claimError } = await service.from('automation_rule_sends').insert({ rule_id: d.rule.id, appointment_id: d.appointmentId })
      if (claimError) return false
    }
    await dispatchPatientRule(service, service, d.rule.account_id, d.rule.id, patient as any, origin, d.appointmentId, {
      triggerEvent: `appointment.${d.rule.atom.moment}`,
      patientId: d.patientId,
      appointmentId: d.appointmentId,
    })
    if (isMorningOf(d.rule.atom)) markSameDay.add(d.appointmentId)
    return true
  })
  if (markSameDay.size) await service.from('appointments').update({ same_day_info_sent_at: now.toISOString() }).in('id', [...markSameDay])
  return flags.filter(Boolean).length
}

/** The day-of message: the start's own day, at a time. */
const isMorningOf = (a: TriggerAtom) => a.moment === 'start' && !!a.timing?.at && a.timing.amount === 0

type Candidate = { id: string; patient_id: string | null }

function statusesOf(rule: AtomRule): string[] {
  const s = (rule.filters as AutomationFilters | null)?.appointment_statuses
  return Array.isArray(s) ? s.filter((x) => typeof x === 'string') : []
}

/** Start or end, moved by the timing, inside [now, now + 20 min). */
async function windowCandidates(service: any, rule: AtomRule, now: Date): Promise<Candidate[]> {
  const offsetMs = timingMinutes(rule.atom.timing) * 60_000
  // The moment is due when anchor + offset = now, so the anchor is now - offset.
  const from = new Date(now.getTime() - offsetMs)
  const to = new Date(from.getTime() + WINDOW_BUFFER_MINUTES * 60_000)
  const column = rule.atom.moment === 'end' ? 'ends_at' : 'starts_at'
  let query = service
    .from('appointments')
    .select('id, patient_id')
    .eq('account_id', rule.account_id)
    // A deleted appointment keeps its status; only deleted_at says so.
    .is('deleted_at', null)
    .not('patient_id', 'is', null)
    .gte(column, from.toISOString())
    .lt(column, to.toISOString())
  const statuses = statusesOf(rule)
  if (statuses.length) query = query.in('status', statuses)
  const { data } = await query
  return (data ?? []) as Candidate[]
}

/**
 * A time of day: in each zone the account's clinics are in, from that time
 * for twenty minutes, the appointments of those clinics starting on the day
 * the timing names (the same day for 0, the next for 1 before...).
 */
async function dayOfCandidates(service: any, rule: AtomRule, now: Date): Promise<Candidate[]> {
  const t = rule.atom.timing!
  const [h, m] = String(t.at).split(':').map(Number)
  const at = (h ?? 9) * 60 + (m ?? 0)
  const { data: clinics } = await service.from('clinics').select('id, timezone').eq('account_id', rule.account_id)
  const zones = new Map<string, string[]>()
  for (const c of (clinics ?? []) as { id: string; timezone: string | null }[]) {
    const tz = c.timezone || DEFAULT_CLINIC_TIMEZONE
    zones.set(tz, [...(zones.get(tz) ?? []), c.id])
  }
  const out: Candidate[] = []
  for (const [tz, clinicIds] of zones) {
    const { minutesSinceMidnight } = localDay(now, tz)
    if (minutesSinceMidnight < at || minutesSinceMidnight >= at + WINDOW_BUFFER_MINUTES) continue
    const day = shiftDate(clinicDateOf(now, tz), t.direction === 'before' ? t.amount : -t.amount)
    const start = startOfLocalDate(day, tz)
    const end = startOfLocalDate(shiftDate(day, 1), tz)
    let query = service
      .from('appointments')
      .select('id, patient_id')
      .eq('account_id', rule.account_id)
      .in('clinic_id', clinicIds)
      .is('deleted_at', null)
      .not('patient_id', 'is', null)
      .gte('starts_at', start.toISOString())
      .lt('starts_at', end.toISOString())
    const statuses = statusesOf(rule)
    if (statuses.length) query = query.in('status', statuses)
    // Already told on its own day -- by this, an older rule, or kept quiet by an import.
    if (isMorningOf(rule.atom)) query = query.or(`same_day_info_sent_at.is.null,same_day_info_sent_at.lt.${start.toISOString()}`)
    const { data } = await query
    out.push(...((data ?? []) as Candidate[]))
  }
  return out
}

// ------------------------------------------------------------------ rows the atoms added

/** How far back the first check after a rule is switched on looks: anything older is not news. */
const LOOKBACK_MS = 2 * 24 * 3600 * 1000
const ROWS_PER_TICK = 200

interface CreatedMoment {
  subject: TriggerSubject
  moment: string
  table: string
  /** When the row came to be. */
  at: string
  /** The column naming the patient it belongs to. */
  patient: string
  /** Extra columns the check reads. */
  columns?: string
  /** Narrows the query: imported rows, voids. */
  narrow?: (q: any) => any
  /** Whether the rule takes this row: its option. */
  takes?: (rule: AtomRule, row: Record<string, any>) => boolean
}

export const CREATED_MOMENTS: CreatedMoment[] = [
  // Imports bring patients in by the thousand; none of them is new to the clinic.
  { subject: 'patient', moment: 'created', table: 'patients', at: 'created_at', patient: 'id', narrow: (q) => q.is('external_reference', null).neq('status', 'inactive') },
  // An imported plan is the patient's history from the previous software, not a plan made today.
  { subject: 'care_plan', moment: 'created', table: 'care_plans', at: 'created_at', patient: 'patient_id', narrow: (q) => q.is('external_reference', null) },
  { subject: 'bono', moment: 'bought', table: 'package_purchases', at: 'purchased_at', patient: 'patient_id', narrow: (q) => q.is('external_reference', null) },
  {
    subject: 'form',
    moment: 'sent',
    table: 'patient_docs',
    at: 'created_at',
    patient: 'patient_id',
    columns: 'template_id',
    // Filled in there and then is not "sent to fill in".
    narrow: (q) => q.is('external_reference', null).is('completed_at', null),
    takes: (rule, row) => {
      const ids = Array.isArray(rule.atom.options.trigger_doc_template_ids) ? (rule.atom.options.trigger_doc_template_ids as string[]) : []
      return ids.length === 0 || ids.includes(row.template_id)
    },
  },
  { subject: 'waitlist', moment: 'joined', table: 'waitlist_entries', at: 'created_at', patient: 'patient_id' },
  { subject: 'invoice', moment: 'issued', table: 'invoices', at: 'created_at', patient: 'patient_id', narrow: (q) => q.is('external_reference', null).eq('is_refund', false).neq('status', 'void') },
]

/**
 * The moments the atoms added, found by the 15-minute check: the rows made
 * since the rule could last have seen them (two days back at most, and never
 * before the rule existed), each claimed in automation_trigger_claims before
 * the rule runs, so each starts it once.
 */
export async function enrolCreatedRows(service: any, origin: string, now = new Date()): Promise<number> {
  let fired = 0
  for (const kind of CREATED_MOMENTS) {
    const rules = (await rulesOnMoment(service, kind.subject, kind.moment)).filter((r) => !isDateAtom(r.atom))
    for (const rule of rules) {
      try {
        const since = new Date(Math.max(now.getTime() - LOOKBACK_MS, new Date(rule.created_at).getTime() - 60_000)).toISOString()
        const columns = ['id', kind.patient === 'id' ? null : kind.patient, kind.at, kind.columns ?? null].filter(Boolean).join(', ')
        let query = service.from(kind.table).select(columns).eq('account_id', rule.account_id).gte(kind.at, since).lte(kind.at, now.toISOString()).order(kind.at).limit(ROWS_PER_TICK)
        if (kind.narrow) query = kind.narrow(query)
        const { data: rows } = await query
        const found = ((rows ?? []) as Record<string, any>[]).filter((row) => row[kind.patient] && (!kind.takes || kind.takes(rule, row)))
        if (!found.length) continue
        const { data: done } = await service.from('automation_trigger_claims').select('source_id').eq('rule_id', rule.id).eq('occurrence', '').in('source_id', found.map((r) => r.id))
        const seen = new Set(((done ?? []) as { source_id: string }[]).map((d) => d.source_id))
        for (const row of found) {
          if (seen.has(row.id)) continue
          const patientId = row[kind.patient] as string
          const { data: patient } = await service.from('patients').select(PATIENT_FOR_RULE_COLUMNS).eq('id', patientId).eq('account_id', rule.account_id).maybeSingle()
          if (!patient || !(await ruleFiltersMatch(service, patientId, rule.filters as AutomationFilters))) continue
          const { error: claimError } = await service.from('automation_trigger_claims').insert({ rule_id: rule.id, source_id: row.id, account_id: rule.account_id })
          if (claimError) continue
          await dispatchPatientRule(service, service, rule.account_id, rule.id, patient, origin, undefined, {
            triggerEvent: `${kind.subject}.${kind.moment}`,
            patientId,
            ...(kind.subject === 'invoice' ? { invoiceId: row.id } : {}),
          })
          fired += 1
        }
      } catch (err) {
        console.error(`[automations] ${kind.subject}.${kind.moment} check failed for rule ${rule.id}:`, (err as Error)?.message ?? err)
      }
    }
  }
  return fired
}
