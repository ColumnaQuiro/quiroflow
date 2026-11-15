// The AI receptionist's report (Growth > AI receptionist > Report), as
// receptionist_report() returns it (20261115172804) and the page reads it.
//
// Pure, with no `~` imports: the app auto-imports this directory too, and in
// its build `~` resolves to mobile/.

export interface ReceptionistReportWeek {
  /** Monday of the week, YYYY-MM-DD on the clinic's clock. */
  week: string
  sent: number
  drafted: number
  conversations: number
  booked: number
  moved: number
  cancelled: number
  handedOver: number
}

/** Who made a change, from the audit trail: the receptionist, a person, or anything else (a reminder's button, the patient app). */
export type ReportActor = 'receptionist' | 'staff' | 'other'

export interface ReportCancellations {
  total: number
  /** Has a visit after the cancellation, booked or had. */
  cameBack: number
  firstVisits: number
  firstVisitsCameBack: number
}

export interface ReceptionistReport {
  /** The first day counted, YYYY-MM-DD. */
  since: string
  weeks: ReceptionistReportWeek[]
  cancellations: Partial<Record<ReportActor, ReportCancellations>>
  moves: Partial<Record<ReportActor, { total: number; earlier: number }>>
  /** By appointments.cancellation_reason; null is "not said". */
  reasons: { reason: string | null; total: number; firstVisits: number; cameBack: number }[]
  earlierOffers: {
    enrolled: number
    offered: number
    messages: number
    accepted: number
    acceptedAttended: number
    acceptedCancelled: number
    declined: number
    closedCancelled: number
    open: number
    /** Average days earlier an accepted offer brought the visit; null when none is known. */
    daysEarlierAccepted: number | null
  }
}

export const REPORT_WEEK_CHOICES = [4, 8, 12] as const

/** Monday of the week `weeks - 1` weeks before `today` (YYYY-MM-DD): the first day a report of that many weeks counts. */
export function reportStartDate(today: string, weeks: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(y, m - 1, d))
  const sinceMonday = (at.getUTCDay() + 6) % 7
  at.setUTCDate(at.getUTCDate() - sinceMonday - 7 * (Math.max(1, weeks) - 1))
  return at.toISOString().slice(0, 10)
}

/** "n of total" as a whole percentage, or null when there is nothing to divide. */
export function shareOf(n: number, total: number): number | null {
  return total > 0 ? Math.round((n / total) * 100) : null
}
