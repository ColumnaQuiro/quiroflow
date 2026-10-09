import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendSeriesConfirmation } from '~/server/utils/appointmentNotifications'
import { sendInboxMessage } from '~/server/utils/inboxSend'

// After the booking panel books a series (Repetir, most often a care plan's
// visits): one confirmation for the first visit and one list of every date,
// instead of a confirmation per visit (sendSeriesConfirmation). Fire-and-
// forget from the panel, like send-confirmation: the bookings are made.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentIds?: string[] }>(event)
  const ids = [...new Set(body?.appointmentIds ?? [])]
  if (!ids.length || ids.length > 60 || ids.some((id) => typeof id !== 'string')) throw createError({ statusCode: 400, statusMessage: 'appointmentIds is required' })

  const access = await requireTeamMember(event)
  const { supabase, teamMember } = access
  // Every one visible to this member, in their account, and one patient's.
  const { data } = await supabase.from('appointments').select('id, patient_id').in('id', ids).eq('account_id', teamMember.account_id)
  const rows = (data ?? []) as { id: string; patient_id: string | null }[]
  if (rows.length !== ids.length) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  if (new Set(rows.map((r) => r.patient_id)).size !== 1 || !rows[0].patient_id) throw createError({ statusCode: 400, statusMessage: 'One patient at a time' })

  const result = await sendSeriesConfirmation(serverSupabaseServiceRole<Database>(event), teamMember.account_id, ids, async (patientId, text) => {
    // The Inbox's own send: the 24h window, the number they last wrote from,
    // and the message row the Inbox and Communications read.
    await sendInboxMessage(event, access, { patientId, text })
  })
  return { success: true, ...result }
})
