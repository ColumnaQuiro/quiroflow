import type { SupabaseClient } from '@supabase/supabase-js'

// Visits that happened and that nothing has paid for yet: no bono session
// against them and no paid receipt. These are what "Log session" should be
// attached to, rather than a visit invented for the occasion.
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
  // the visit voids it: the bono pays for the visit, so it cannot also owe.
  unpaidInvoice: { id: string; invoice_number: string | null; total_cents: number } | null
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
    supabase.from('invoices').select('id, invoice_number, total_cents, status, appointment_id, is_refund').in('appointment_id', ids).neq('status', 'void'),
  ])
  const covered = new Set((sessions ?? []).map((s) => s.appointment_id))
  const paid = new Set((invoices ?? []).filter((i) => i.status === 'paid' && !i.is_refund).map((i) => i.appointment_id))

  return appts
    .filter((a) => !covered.has(a.id) && !paid.has(a.id))
    .map((a) => {
      const unpaid = (invoices ?? []).find((i) => i.appointment_id === a.id && i.status === 'unpaid' && !i.is_refund) ?? null
      return {
        id: a.id,
        starts_at: a.starts_at,
        practitionerId: a.practitioner_id ?? null,
        practitionerName: (a.practitioner as unknown as { full_name: string } | null)?.full_name ?? null,
        typeName: (a.appointment_types as unknown as { name: string } | null)?.name ?? null,
        unpaidInvoice: unpaid ? { id: unpaid.id, invoice_number: unpaid.invoice_number, total_cents: unpaid.total_cents } : null,
      }
    })
}

// What the Log session dialog hands back: a visit from the list, or a day for
// a visit that was never on the calendar.
export type LogSessionChoice = { kind: 'visit'; visit: UnloggedVisit } | { kind: 'new'; dateStr: string }

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
