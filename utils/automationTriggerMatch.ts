// Whether a rule's own trigger settings take a particular event -- which tag,
// which score, which form, which lead stage. Stored in automation_rules.filters
// beside the "only if" filters, under trigger_* keys so evaluateAutomationFilters
// never mistakes one for a filter of its own (tag_contains is one: "has a tag
// containing", a different question from "this tag was just added").
//
// An empty setting takes every event of its kind. Pure, so the server and the
// unit tests ask the same question.

import { markerForVisit, type CarePlanVisitMarker } from './carePlanVisitMarkers'

type Filters = Record<string, unknown> | null | undefined

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/** patient.tag_added / patient.tag_removed: the tag, ignoring case and spaces at either end. */
export function triggerTagMatches(filters: Filters, tag: string): boolean {
  const want = norm(filters?.trigger_tag)
  return !want || want === norm(tag)
}

/** patient.type_added / patient.type_removed: the type, or any when none is chosen. */
export function triggerTypeMatches(filters: Filters, typeId: string): boolean {
  const want = filters?.trigger_type_id
  return typeof want !== 'string' || !want || want === typeId
}

/** satisfaction.answered: 'high' is 4-5, 'low' is 1-3, anything else any score. */
export function triggerScoreMatches(filters: Filters, score: number): boolean {
  if (filters?.trigger_score === 'high') return score >= 4
  if (filters?.trigger_score === 'low') return score <= 3
  return true
}

/** doc.completed: one of these form templates, or any form when none is chosen. */
export function triggerDocMatches(filters: Filters, templateId: string | null): boolean {
  const ids = Array.isArray(filters?.trigger_doc_template_ids) ? (filters!.trigger_doc_template_ids as unknown[]).filter((x) => typeof x === 'string') : []
  return ids.length === 0 || (!!templateId && ids.includes(templateId))
}

/** lead.stage_changed: the stage it was moved to. */
export function triggerStageMatches(filters: Filters, stage: string): boolean {
  const want = filters?.trigger_lead_stage
  return typeof want !== 'string' || !want || want === stage
}

/**
 * care_plan.milestone, for the visit just completed, the kth of its plan:
 *  - 'reexam_next' (the default): the plan marks the next visit, k+1, as a
 *    re-exam (utils/carePlanVisitMarkers.ts), so it is time to book it;
 *  - 'finished': it was the plan's last visit;
 *  - 'visit': it was visit number trigger_visit_number.
 */
export function triggerCarePlanMatches(
  filters: Filters,
  k: number,
  plan: { total_visits: number | null; markers: CarePlanVisitMarker[] },
): boolean {
  const kind = filters?.trigger_milestone
  if (kind === 'finished') return !!plan.total_visits && k === plan.total_visits
  if (kind === 'visit') return k === Number(filters?.trigger_visit_number)
  return !!markerForVisit(plan.markers, k + 1)
}

/** bono.running_low: the sessions left after the one just used, at most trigger_sessions_left (1 by default; 0 is used up). */
export function triggerBonoMatches(filters: Filters, sessionsLeft: number): boolean {
  const n = Number(filters?.trigger_sessions_left)
  const threshold = Number.isInteger(n) && n >= 0 ? n : 1
  return sessionsLeft <= threshold
}

// ------------------------------------------------------------------ patient.date

/** Which date on the record "A date on the record" counts from. A custom date field is `field:<patient_attributes.id>`. */
export type DateTriggerSource = 'last_visit' | 'membership_start' | 'care_plan_start' | `field:${string}`

/** Whether a source can be counted back from: only a custom field can hold a date still to come (a due date, an operation). */
export const dateSourceAllowsBefore = (source: string) => source.startsWith('field:')

/** A YYYY-MM-DD date moved by whole days, calendar-wise (no time zone or summer time in it). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The date on the record that makes the rule start today (the clinic's
 * today): N days after it is today minus N, N days before it today plus N.
 * Null when the rule has no usable setting.
 */
export function dateTriggerSourceDate(filters: Filters, today: string): string | null {
  const source = String(filters?.trigger_date ?? '')
  if (!source) return null
  const days = Number(filters?.trigger_days)
  if (!Number.isInteger(days) || days < 0 || days > 3650) return null
  const before = filters?.trigger_when === 'before' && dateSourceAllowsBefore(source)
  return shiftDate(today, before ? days : -days)
}
