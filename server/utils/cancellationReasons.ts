import type { CancellationReason } from '~/utils/cancellationReason'

// Recording why a visit was cancelled (appointments.cancellation_reason,
// 20261115172804), from the two places that hear it: the AI receptionist's
// tools (receptionistBooking.ts) and a tap on the reasons it sent
// (api/whatsapp/webhook.post.ts), which records it before the receptionist
// even reads the reply.

/** A first visit, as appointment_types.stage marks one (the earlier-time offers read it the same way). */
export function isFirstVisitStage(stage: string | null | undefined): boolean {
  return stage === 'first_visit' || stage === 'first_visit_offer'
}

/**
 * The patient's visit cancelled most recently, by anyone, in the last
 * fortnight -- with whether it was a first visit -- or null. Read from the
 * audit trail, the only record of WHEN a visit was cancelled.
 */
export async function findLastCancelledVisit(client: any, accountId: string, patientId: string): Promise<{ id: string; firstVisit: boolean } | null> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data: logs } = await client
    .from('audit_logs')
    .select('entity_id, changes')
    .eq('account_id', accountId)
    .eq('entity_type', 'appointment')
    .eq('patient_id', patientId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30)
  const row = ((logs ?? []) as { entity_id: string | null; changes: Record<string, { to?: unknown }> | null }[]).find((l) => l.entity_id && l.changes?.status?.to === 'cancelled')
  if (!row?.entity_id) return null
  const { data: appt } = await client
    .from('appointments')
    .select('id, status, appointment_types(stage)')
    .eq('id', row.entity_id)
    .eq('account_id', accountId)
    .maybeSingle()
  const found = appt as { id: string; status: string; appointment_types: { stage: string | null } | null } | null
  if (!found || found.status !== 'cancelled') return null
  return { id: found.id, firstVisit: isFirstVisitStage(found.appointment_types?.stage) }
}

/**
 * Someone who has never come said they will book their first visit later:
 * on the Recalls list from now on (patients.first_visit_deferred_at).
 * Someone who has come before is on it anyway, by their last visit, so
 * nothing is written for them.
 */
export async function deferFirstVisit(writer: any, accountId: string, patientId: string): Promise<void> {
  try {
    const { count } = await writer
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('patient_id', patientId)
      .eq('status', 'completed')
      .is('deleted_at', null)
    if ((count ?? 0) > 0) return
    const { error } = await writer.from('patients').update({ first_visit_deferred_at: new Date().toISOString() }).eq('id', patientId).eq('account_id', accountId)
    if (error) console.error('[cancellation-reason] could not put the first visit off for later:', error.message)
  } catch (err) {
    console.error('[cancellation-reason] could not put the first visit off for later:', (err as Error)?.message ?? err)
  }
}

/** The reason on the visit, and for a first visit put off for later, onto Recalls. Best-effort: logged, never thrown. */
export async function recordCancellationReason(writer: any, accountId: string, patientId: string, visit: { id: string; firstVisit: boolean }, reason: CancellationReason): Promise<void> {
  const { error } = await writer.from('appointments').update({ cancellation_reason: reason }).eq('id', visit.id).eq('account_id', accountId)
  if (error) console.error('[cancellation-reason] could not record it:', error.message)
  if (reason === 'later' && visit.firstVisit) await deferFirstVisit(writer, accountId, patientId)
}
