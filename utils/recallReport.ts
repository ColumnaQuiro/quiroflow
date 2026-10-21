// Reports › Recalls (pages/reports/recalls.vue): what the recall automations
// brought back. For each rule, the patients it reached in the period, and of
// them who replied, who booked, who came and who asked not to be contacted --
// each counted only within RECALL_WINDOW_DAYS of the first message, the window
// the plan measures against (docs/recall-automation-plan.md, September's
// manual recall: 16 of 100 booked).
//
// Pure, so the arithmetic is unit-tested (tests/unit/recall-report.test.ts);
// the page reads the rows and hands them over.

export const RECALL_WINDOW_DAYS = 30
const DAY = 86_400_000

export interface RecallRule {
  id: string
  name: string
  trigger_event: string
  entry_mode: string | null
}
/** One message a rule sent a patient: a WhatsApp or an email. */
export interface RecallSend {
  rule_id: string
  patient_id: string
  at: string
}
export interface RecallReply {
  patient_id: string
  at: string
}
export interface RecallBooking {
  patient_id: string
  created_at: string
  starts_at: string
  status: string
  source: string | null
  price_cents: number | null
}
export interface RecallPatient {
  id: string
  first_name: string | null
  last_name: string | null
  do_not_contact: boolean | null
}

export type RecallStatus = 'booked' | 'replied' | 'opted_out' | 'waiting' | 'no_reply'

export interface RecallReportRow {
  ruleId: string
  patientId: string
  name: string
  contactedAt: string
  status: RecallStatus
  /** The visit they booked, the first in the window. */
  booking: RecallBooking | null
  repliedAt: string | null
}

export interface RecallRuleStats {
  ruleId: string
  name: string
  contacted: number
  replied: number
  booked: number
  came: number
  optedOut: number
  /** Contacted under RECALL_WINDOW_DAYS ago with nothing yet: still to tell. */
  waiting: number
  valueCents: number
  /** Booked by the AI receptionist (appointments.source). */
  byReceptionist: number
}

/**
 * Which rules a recall report is about unless someone picks otherwise: the
 * ones that look for lapsed patients (a segment), or hold one patient at a
 * time until they book ("Recuperar tras la visita"). Reminders and
 * confirmations fire on every visit and are not recalls.
 */
export function isRecallRule(rule: Pick<RecallRule, 'trigger_event' | 'entry_mode'>): boolean {
  return rule.trigger_event === 'segment' || rule.entry_mode === 'one_at_a_time'
}

/** Whether a visit counts as booked: anything not called off. */
const live = (b: RecallBooking) => b.status !== 'cancelled'

export function recallReport(
  input: { rules: RecallRule[]; sends: RecallSend[]; replies: RecallReply[]; bookings: RecallBooking[]; patients: RecallPatient[] },
  now = new Date(),
): { rows: RecallReportRow[]; byRule: RecallRuleStats[]; totals: Omit<RecallRuleStats, 'ruleId' | 'name'> } {
  const patients = new Map(input.patients.map((p) => [p.id, p]))
  const rules = new Map(input.rules.map((r) => [r.id, r]))
  const sortedBy = <T>(list: T[], at: (x: T) => string) => [...list].sort((a, b) => at(a).localeCompare(at(b)))

  // First message per rule and patient: where their 30 days start.
  const first = new Map<string, RecallSend>()
  for (const s of sortedBy(input.sends, (s) => s.at)) {
    const key = `${s.rule_id}:${s.patient_id}`
    if (!first.has(key) && rules.has(s.rule_id)) first.set(key, s)
  }
  const repliesOf = groupBy(sortedBy(input.replies, (r) => r.at), (r) => r.patient_id)
  const bookingsOf = groupBy(sortedBy(input.bookings, (b) => b.created_at), (b) => b.patient_id)

  const rows: RecallReportRow[] = []
  for (const s of first.values()) {
    const from = Date.parse(s.at)
    const until = from + RECALL_WINDOW_DAYS * DAY
    const inWindow = (at: string) => {
      const t = Date.parse(at)
      return t > from && t <= until
    }
    const booking = (bookingsOf.get(s.patient_id) ?? []).find((b) => live(b) && inWindow(b.created_at)) ?? null
    const repliedAt = (repliesOf.get(s.patient_id) ?? []).find((r) => inWindow(r.at))?.at ?? null
    const p = patients.get(s.patient_id)
    const status: RecallStatus = booking
      ? 'booked'
      : p?.do_not_contact
        ? 'opted_out'
        : repliedAt
          ? 'replied'
          : now.getTime() < until
            ? 'waiting'
            : 'no_reply'
    rows.push({
      ruleId: s.rule_id,
      patientId: s.patient_id,
      name: `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || '—',
      contactedAt: s.at,
      status,
      booking,
      repliedAt,
    })
  }
  rows.sort((a, b) => b.contactedAt.localeCompare(a.contactedAt))

  const stats = (list: RecallReportRow[]) => {
    const booked = list.filter((r) => r.booking)
    return {
      contacted: list.length,
      replied: list.filter((r) => r.repliedAt).length,
      booked: booked.length,
      came: booked.filter((r) => r.booking!.status === 'completed').length,
      optedOut: list.filter((r) => r.status === 'opted_out').length,
      waiting: list.filter((r) => r.status === 'waiting').length,
      valueCents: booked.reduce((sum, r) => sum + (r.booking!.price_cents ?? 0), 0),
      byReceptionist: booked.filter((r) => r.booking!.source === 'receptionist').length,
    }
  }
  const byRule = [...groupBy(rows, (r) => r.ruleId)]
    .map(([ruleId, list]) => ({ ruleId, name: rules.get(ruleId)?.name ?? '—', ...stats(list) }))
    .sort((a, b) => b.contacted - a.contacted)

  // Totals count each patient once, at their first recall in the period: one
  // person reached by two rules is one person brought back, not two.
  const once = new Map<string, RecallReportRow>()
  for (const r of [...rows].reverse()) if (!once.has(r.patientId)) once.set(r.patientId, r)
  return { rows, byRule, totals: stats([...once.values()]) }
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const x of list) {
    const k = key(x)
    const bucket = out.get(k)
    if (bucket) bucket.push(x)
    else out.set(k, [x])
  }
  return out
}
