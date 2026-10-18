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

/** Whether any of these filters needs the patient's completed visits read at all. */
export function needsVisitHistory(f: VisitHistoryFilters | null | undefined): boolean {
  if (!f) return false
  return counted(f.total_visits) || counted(f.min_visits) || counted(f.max_visits) || positive(f.last_visit_before_days) || positive(f.last_visit_within_days)
}

/**
 * Whether a patient with `count` completed visits, the latest at `lastVisitAt`
 * (ms since the epoch, or null when they have none), passes these filters at
 * `now`. "Before" is exclusive and "within" inclusive at the boundary, so a
 * band "within 180, before 90" reads 91..180 days, and the two bands a plan
 * splits at 180 days do not both take the same person.
 */
export function visitHistoryMatches(f: VisitHistoryFilters | null | undefined, count: number, lastVisitAt: number | null, now: number): boolean {
  if (!f) return true
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
