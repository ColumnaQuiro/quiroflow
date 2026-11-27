// The visit-history tests a segment or trigger filter makes of one patient,
// as plain functions of numbers, so the two places that evaluate filters --
// per patient at enrolment (server/utils/evaluateAutomationFilters.ts) and
// in bulk for the live count (server/utils/segmentAudience.ts) -- answer the
// same question the same way. The segment e2e spec checks they agree; this is
// what makes that cheap to keep true.
//
// A recall is keyed on bands: "last visit 90 to 180 days ago, two or more
// visits" cannot be said with "more than N days ago" and "exactly N visits",
// which is all there was until these were added.

export const DAY_MS = 24 * 3600 * 1000

export interface VisitHistoryFilters {
  /** Exactly this many completed visits. */
  total_visits?: number | null
  /** At least this many completed visits. */
  min_visits?: number | null
  /** At most this many completed visits. */
  max_visits?: number | null
  /** At least one completed visit, the latest more than this many days ago. */
  last_visit_before_days?: number | null
  /** At least one completed visit, the latest at most this many days ago. */
  last_visit_within_days?: number | null
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
const counted = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/**
 * The visit types a segment filter narrows the patient's history to
 * ("Tipo de visita": visit_type_ids), or null for any type. An empty list
 * means any, as every list filter does.
 */
export function visitTypeIdsOf(f: { visit_type_ids?: unknown } | null | undefined): string[] | null {
  const ids = Array.isArray(f?.visit_type_ids) ? f.visit_type_ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
  return ids.length ? ids : null
}

/** Whether any of these filters needs the patient's completed visits read at all. */
export function needsVisitHistory(f: (VisitHistoryFilters & { visit_type_ids?: unknown }) | null | undefined): boolean {
  if (!f) return false
  return !!visitTypeIdsOf(f) || counted(f.total_visits) || counted(f.min_visits) || counted(f.max_visits) || positive(f.last_visit_before_days) || positive(f.last_visit_within_days)
}

/**
 * Whether a patient with `count` completed visits, the latest at `lastVisitAt`
 * (ms since the epoch, or null when they have none), passes these filters at
 * `now`. "Before" is exclusive and "within" inclusive at the boundary, so a
 * band "within 180, before 90" reads 91..180 days, and the two bands a plan
 * splits at 180 days do not both take the same person.
 */
export function visitHistoryMatches(f: (VisitHistoryFilters & { visit_type_ids?: unknown }) | null | undefined, count: number, lastVisitAt: number | null, now: number): boolean {
  if (!f) return true
  // "Tipo de visita": at least one completed visit of those types. The
  // caller has already counted only them, so `count` is theirs.
  if (visitTypeIdsOf(f) && count === 0) return false
  if (counted(f.total_visits) && count !== f.total_visits) return false
  if (counted(f.min_visits) && count < f.min_visits) return false
  if (counted(f.max_visits) && count > f.max_visits) return false
  if (positive(f.last_visit_before_days)) {
    if (lastVisitAt === null) return false
    if (lastVisitAt >= now - f.last_visit_before_days * DAY_MS) return false
  }
  if (positive(f.last_visit_within_days)) {
    if (lastVisitAt === null) return false
    if (lastVisitAt < now - f.last_visit_within_days * DAY_MS) return false
  }
  return true
}

/**
 * "Nothing sent to them on WhatsApp in N days", by anyone: a person from the
 * Inbox or Recalls, or another automation. `lastSentAt` is the newest
 * outbound row that was really attempted (a dry run's would_send is not a
 * send). A failed attempt counts: hammering a number that just failed is what
 * the filter is there to stop.
 */
export function noWhatsAppSentMatches(days: number | null | undefined, lastSentAt: number | null, now: number): boolean {
  if (!positive(days)) return true
  if (lastSentAt === null) return true
  return lastSentAt < now - days * DAY_MS
}

/** The newest instant among `rows`' timestamps, or null for none. */
export function newestAt(rows: { at: string | null | undefined }[]): number | null {
  let newest: number | null = null
  for (const r of rows) {
    if (!r.at) continue
    const t = new Date(r.at).getTime()
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t
  }
  return newest
}

/**
 * Whether a segment rule is a recall, and so leaves out whoever the Recalls
 * queue has parked: a non-marketing rule keyed on "last visit more than N
 * days ago". Decided from the filters alone because that is all both
 * evaluators have -- the live count is asked about a rule still being edited,
 * before its steps are saved -- and every recall starter is exactly this
 * shape. A marketing rule is not: whoever receives one asked to, by channel,
 * and Descartar on the Recalls page says nothing about that.
 */
export function respectsRecallQueue(f: VisitHistoryFilters | null | undefined, isMarketing: boolean): boolean {
  return !isMarketing && positive(f?.last_visit_before_days)
}

export interface RecallQueueState {
  recall_status: string | null
  /** A date (YYYY-MM-DD): Posponer, or a "Más adelante" reply. */
  recall_snoozed_until: string | null
  recall_dismissed_at: string | null
}

/**
 * Whether the Recalls queue has this patient parked, by the rule of the
 * recall_candidates view: snoozed while recall_snoozed_until is after
 * `today` (the clinic's own date, YYYY-MM-DD), and dismissed (Descartar)
 * until a visit they attended after recall_dismissed_at. `lastAttendedAt` is
 * their latest visit up to now that was neither cancelled nor a no-show (ms,
 * or null). A dismissal with no date never lifts, as in the view.
 */
export function recallParked(p: RecallQueueState, lastAttendedAt: number | null, today: string): boolean {
  if (p.recall_snoozed_until && p.recall_snoozed_until > today) return true
  if (p.recall_status !== 'dismissed') return false
  if (!p.recall_dismissed_at || lastAttendedAt === null) return true
  return lastAttendedAt <= new Date(p.recall_dismissed_at).getTime()
}

/**
 * A saved audience: one of the clinic's patient lists or segments
 * (patient_lists / patient_segments, 20261105143740). A group send names one
 * in segment.audience, with others to leave out in segment.exclude, and the
 * "enters a list or segment" trigger names one in filters.trigger_audience.
 */
export interface AudienceRef {
  kind: 'list' | 'segment'
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A stored value as an audience, or null for anything else. */
export function asAudienceRef(v: unknown): AudienceRef | null {
  if (!v || typeof v !== 'object') return null
  const { kind, id } = v as { kind?: unknown; id?: unknown }
  return (kind === 'list' || kind === 'segment') && typeof id === 'string' && UUID.test(id) ? { kind, id } : null
}

/** A stored list of audiences, keeping only the ones that read as audiences. */
export function asAudienceRefs(v: unknown): AudienceRef[] {
  return Array.isArray(v) ? v.map(asAudienceRef).filter((x): x is AudienceRef => !!x).slice(0, 10) : []
}

/**
 * The most patients a send can name one by one. Past this, the people are
 * a group with a rule to them, and a saved segment (or a list) says so and
 * keeps the rule's jsonb small enough to load with the automation.
 */
export const MAX_PICKED_PATIENTS = 2000

/**
 * A stored list of hand-picked patients (segment.patient_ids): the ids that
 * read as ids, each once, in the order chosen, capped. Who they are is
 * decided when they are picked, not when the send goes out -- unlike a list
 * or segment -- but the send's gates (consent, archived, minors) are still
 * asked when it goes.
 */
export function asPatientIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of v) {
    if (typeof id !== 'string' || !UUID.test(id)) continue
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= MAX_PICKED_PATIENTS) break
  }
  return out
}

/**
 * Whether a patient passes the "is / is not in a list or segment" trigger
 * filter, given the audiences they are in now (`memberOf`, as "kind:id").
 * `in_audiences` is any-of: being in one of them is enough. `not_in_audiences`
 * is none-of. An empty or missing list asks nothing, so a row just added
 * (still empty) does not stop the rule.
 */
export function audienceFilterMatches(
  f: { in_audiences?: unknown; not_in_audiences?: unknown } | null | undefined,
  memberOf: Set<string>,
): boolean {
  if (!f) return true
  const inside = asAudienceRefs(f.in_audiences)
  if (inside.length && !inside.some((a) => memberOf.has(`${a.kind}:${a.id}`))) return false
  const outside = asAudienceRefs(f.not_in_audiences)
  if (outside.some((a) => memberOf.has(`${a.kind}:${a.id}`))) return false
  return true
}

/** Whether a filters object asks about lists or segments at all. */
export function needsAudienceMembership(f: { in_audiences?: unknown; not_in_audiences?: unknown } | null | undefined): boolean {
  return !!f && (asAudienceRefs(f.in_audiences).length > 0 || asAudienceRefs(f.not_in_audiences).length > 0)
}
