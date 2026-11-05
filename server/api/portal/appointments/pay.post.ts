import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { APP_VISIT_COLUMNS, payAppVisit } from '~/server/utils/appPayments'

// "Pagar" on a visit in the patient app: ahead of a booked visit, or for the
// one just had. The saved card is charged here; with none, or when the bank
// asks for 3-D Secure, the answer is a page to open in the browser. Price,
// eligibility and recording all live in server/utils/appPayments.ts.
//
// The visit is read through the caller's own client, so RLS decides whether
// it is theirs.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId?: string }>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: own } = await supabase.from('appointments').select('id').eq('id', body.appointmentId).maybeSingle()
  if (!own) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: visit } = await service.from('appointments').select(APP_VISIT_COLUMNS).eq('id', own.id).maybeSingle()
  if (!visit) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })

  return payAppVisit(event, service, visit)
})
