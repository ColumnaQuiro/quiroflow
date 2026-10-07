import type { SupabaseClient } from '@supabase/supabase-js'

// Visits that happened and that nothing has paid for yet: no bono session
// against them and no paid receipt. These are what "Log session" should be
// attached to, rather than a visit invented for the occasion. Alongside them,
// flagged as such, a visit paid at the walk-in price whose money can move onto
// a bono bought afterwards (paidVisitToMove).
//
// It used to look at today only. Anything earlier went through "Another
// date", which could not see the calendar and always invented a visit: Teresa
// Davis's 15 Sep session, logged on 24 Sep, became a second, typeless 12:00
// visit that day while her real 10:30 one stayed uncovered -- two visits on
// the calendar for one appointment, and a receipt on the wrong one.
//
// Measured on 24 Sep 2026 across the clinic: of 147 visits since go-live,
// 3 matched this. A short list, so it is shown to reception whole.

// How far back to look. Catching up is about the last few weeks; beyond that
// it is migrated history, which PracticeHub settled on its own terms.
export const UNLOGGED_VISIT_LOOKBACK_DAYS = 30

export interface UnloggedVisit {
  id: string
  starts_at: string
  practitionerId: string | null
  practitionerName: string | null
  typeName: string | null
  // A charge raised on the visit and not paid. Logging a bono session against
  // the visit replaces the visit's own line on it with the bono session's
  // charge; any extras on it stay owed (utils/bonoVisitInvoice).
  unpaidInvoice: { id: string; invoice_number: string | null; total_cents: number } | null
  // The visit was already paid, at the walk-in price, before the patient
  // bought the bono. Logging the session against it makes the receipt the
  // session's charge and moves what was paid on it onto the bono -- see
  // paidVisitToMove below.
  paidInvoice: { id: string; invoice_number: string | null; total_cents: number; paidCents: number } | null
}

interface VisitReceipt {
  id: string
  invoice_number: string | null
  total_cents: number
  status: string
  is_refund: boolean | null
  invoice_line_items: { service_id: string | null; package_purchase_id: string | null }[]
  payments: { amount_cents: number; method: string }[]
}

/**
 * A visit paid in full at the walk-in price that a bono bought afterwards
 * should have covered.
 *
 * A patient who said they did not want a bono pays 60 EUR for a visit, then
 * buys a 10-session bono a few days later at 46 EUR a session, and the clinic
 * counts that first visit as one of the ten. Log session refused it -- a paid
 * visit is not "unlogged" -- and the only control
 * left was Link a payment, which pointed the 60 EUR at the bono while it went
 * on paying the visit: the same euros counted twice, and the bono reading 60
 * EUR better paid than it was.
 *
 * Only the plain case, where moving the money cannot take anything else with
 * it: one receipt for the visit, carrying nothing but the visit (an extra sold
 * alongside it is still owed in money), and settled by money that came in --
 * a write-off collected nothing, and a refund against it has already handed
 * part of it back.
 */
export function paidVisitToMove(receipts: VisitReceipt[], refundedIds: ReadonlySet<string>): VisitReceipt | null {
  const live = receipts.filter((r) => r.status !== 'void' && !r.is_refund)
  if (live.length !== 1) return null
  const receipt = live[0]
  if (receipt.status !== 'paid' || refundedIds.has(receipt.id)) return null
  if (receipt.invoice_line_items.some((l) => l.service_id || l.package_purchase_id)) return null
  const payments = receipt.payments ?? []
  if (payments.length === 0 || payments.some((p) => p.method === 'write_off' || p.amount_cents <= 0)) return null
  return receipt
}

// Checked in counts as happened, not only completed: the front desk logs the
// session while the patient is still in the room (Tomas Berenguer's was logged
// 62 seconds before he was checked out). A booking nobody has arrived for is
// left out, which is what stops a session being spent in advance.
export async function loadUnloggedVisits(supabase: SupabaseClient, patientId: string): Promise<UnloggedVisit[]> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - UNLOGGED_VISIT_LOOKBACK_DAYS)

  const { data: appts } = await supabase
    .from('appointments')
    .select('id, starts_at, practitioner_id, appointment_types(name), practitioner:team_members!appointments_practitioner_id_fkey(full_name)')
    .eq('patient_id', patientId)
    .neq('status', 'cancelled')
    .or('status.eq.completed,checked_in_at.not.is.null')
    .is('deleted_at', null)
    .gte('starts_at', since.toISOString())
    .lte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
  if (!appts || appts.length === 0) return []

  const ids = appts.map((a) => a.id)
  const [{ data: sessions }, { data: invoices }] = await Promise.all([
    supabase.from('package_sessions').select('appointment_id').in('appointment_id', ids),
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, total_cents, status, appointment_id, is_refund, invoice_line_items(service_id, package_purchase_id), payments!payments_invoice_id_fkey(amount_cents, method)',
      )
      .in('appointment_id', ids)
      .neq('status', 'void'),
  ])
  const rows = (invoices ?? []) as unknown as (VisitReceipt & { appointment_id: string })[]
  const covered = new Set((sessions ?? []).map((s) => s.appointment_id))

  // Refunds name the receipt they correct, and are not on the visit.
  const paidIds = rows.filter((i) => i.status === 'paid' && !i.is_refund).map((i) => i.id)
  const { data: refunds } = paidIds.length
    ? await supabase.from('invoices').select('refunds_invoice_id').eq('is_refund', true).in('refunds_invoice_id', paidIds)
    : { data: [] as { refunds_invoice_id: string }[] }
  const refunded = new Set((refunds ?? []).map((r) => r.refunds_invoice_id as string))

  return appts
    .filter((a) => !covered.has(a.id))
    .map((a) => {
      const own = rows.filter((i) => i.appointment_id === a.id)
      const isPaid = own.some((i) => i.status === 'paid' && !i.is_refund)
      const movable = isPaid ? paidVisitToMove(own, refunded) : null
      return { a, own, isPaid, movable }
    })
    // A paid visit stays off the list unless its payment can move to the bono.
    .filter(({ isPaid, movable }) => !isPaid || movable)
    .map(({ a, own, movable }) => {
      const unpaid = own.find((i) => i.status === 'unpaid' && !i.is_refund) ?? null
      return {
        id: a.id,
        starts_at: a.starts_at,
        practitionerId: a.practitioner_id ?? null,
        practitionerName: (a.practitioner as unknown as { full_name: string } | null)?.full_name ?? null,
        typeName: (a.appointment_types as unknown as { name: string } | null)?.name ?? null,
        unpaidInvoice: unpaid ? { id: unpaid.id, invoice_number: unpaid.invoice_number, total_cents: unpaid.total_cents } : null,
        paidInvoice: movable
          ? {
              id: movable.id,
              invoice_number: movable.invoice_number,
              total_cents: movable.total_cents,
              paidCents: movable.payments.reduce((sum, p) => sum + p.amount_cents, 0),
            }
          : null,
      }
    })
}

// What the Log session dialog hands back: a visit from the list, or a day for
// a visit that was never on the calendar.
export type LogSessionChoice = { kind: 'visit'; visit: UnloggedVisit } | { kind: 'new'; dateStr: string }

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
