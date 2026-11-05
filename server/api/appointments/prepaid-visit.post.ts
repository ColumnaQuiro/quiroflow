import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { keepVisitPaymentsAsCredit, refundVisitCardPayments } from '~/server/utils/appPayments'

// A visit someone paid for ahead by card, cancelled by the clinic: the money
// goes back to the card, or stays on the patient's account as credit. Asked
// in the cancel step (components/calendar/CancelStep.vue, and the app's
// CancelVisitSheet.vue) whenever the visit carries card money taken through
// Stripe -- paid from the patient app or as an online-booking deposit.
//
// The refund goes through Stripe and is recorded as the desk records one;
// the credit voids the visit's receipt and keeps the money as a top-up. See
// server/utils/appPayments.ts for both.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId?: string; action?: 'refund' | 'credit' }>(event)
  if (!body?.appointmentId || (body.action !== 'refund' && body.action !== 'credit')) {
    throw createError({ statusCode: 400, statusMessage: 'appointmentId and action (refund | credit) are required' })
  }

  // Moving money, as cancellation-fee.post.ts's card charge is.
  const { supabase, teamMember } = await requirePermission(event, 'billing_access')
  const { data: visit } = await supabase.from('appointments').select('id, account_id, patient_id, status').eq('id', body.appointmentId).maybeSingle()
  if (!visit || visit.account_id !== teamMember.account_id) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  if (visit.status !== 'cancelled') throw createError({ statusCode: 409, statusMessage: 'Only a cancelled visit gives its payment back' })

  // After the guard, so the writes are attributed to whoever pressed it
  // (server/utils/auditActor.ts).
  const service = serverSupabaseServiceRole<Database>(event)
  if (body.action === 'refund') {
    const { refundedCents } = await refundVisitCardPayments(event, service, visit, { reason: 'Cita cancelada por la clínica', onlyAppPayments: false })
    return { refundedCents, creditedCents: 0 }
  }
  const { creditedCents } = await keepVisitPaymentsAsCredit(service, visit)
  return { refundedCents: 0, creditedCents }
})
