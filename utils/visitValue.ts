// What a visit was worth, as opposed to what was taken on the day.
//
// "Average income per visit" used to be the period's takings divided by its
// visits. Most visits here are bono sessions, and a bono is paid when it is
// bought -- so a month that USES bonos bought earlier counts every one of
// those visits and none of their money. One practitioner, 1-23 Nov 2026:
// 156 visits, 123 of them bono sessions, 104 from bonos bought before
// November. The report said 36,55 EUR a visit, below the cheapest bono
// session (40 EUR); what the visits were actually worth was 45,61 EUR. A
// month that sells bonos it will not use until later reads high for the same
// reason, which is how the figure "fell 28%" with nothing having changed.
//
// So a visit is valued at:
//   - the bono session it used (package_sessions.amount_cents: the bono's
//     price spread over its sessions), when it used one -- whatever invoice
//     the visit also carries, since an invoice raised at a bono visit is
//     either the session's own charge or the bono's sale (593 of those);
//   - otherwise its invoices, void ones left out, paid or not: a visit
//     charged and not yet paid was still worth that.
//
// A visit with neither -- a membership visit, a courtesy re-exam, one not
// charged yet -- has no value here at all, which is not the same as being
// worth nothing, so it is left out of the average rather than counted as 0.
//
// Pure, with no imports: the app (mobile/) reaches this through the report
// engine too.

export interface VisitSessionRow {
  appointment_id: string | null
  amount_cents: number | null
}
export interface VisitInvoiceRow {
  appointment_id: string | null
  total_cents: number
  status: string
}

/** Appointment id -> what that visit was worth, in cents. Visits with no value are absent. */
export function visitValues(sessions: VisitSessionRow[], invoices: VisitInvoiceRow[]): Map<string, number> {
  const bySession = new Map<string, number>()
  for (const s of sessions) {
    if (!s.appointment_id || s.amount_cents == null) continue
    bySession.set(s.appointment_id, (bySession.get(s.appointment_id) ?? 0) + s.amount_cents)
  }
  const out = new Map(bySession)
  for (const i of invoices) {
    if (!i.appointment_id || i.status === 'void' || bySession.has(i.appointment_id)) continue
    out.set(i.appointment_id, (out.get(i.appointment_id) ?? 0) + i.total_cents)
  }
  return out
}

/** Mean value of these visits in cents, over the ones that have a value; null when none does. */
export function averageVisitValueCents(appointmentIds: Iterable<string>, values: Map<string, number>): number | null {
  let sum = 0
  let n = 0
  for (const id of appointmentIds) {
    const v = values.get(id)
    if (v === undefined) continue
    sum += v
    n++
  }
  return n ? Math.round(sum / n) : null
}
