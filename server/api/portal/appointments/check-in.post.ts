import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { afterPatientArrival } from '~/server/utils/patientArrival'

// "Ya estoy aquí": a patient checking themselves in on arrival, from the app,
// the portal, or the desk's QR code (/portal/check-in).
//
// The arrival itself is check_in_my_appointment, run as the patient: their
// own visit, still booked, and only from 90 minutes before it until it ends.
// Then what the desk's "Mark as arrived" does (afterPatientArrival). A second
// tap returns the first arrival and tells nobody again.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId?: string }>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: before } = await supabase.from('appointments').select('checked_in_at').eq('id', body.appointmentId).maybeSingle()
  const { data: at, error } = await supabase.rpc('check_in_my_appointment', { p_appointment_id: body.appointmentId })
  if (error) throw createError({ statusCode: 400, statusMessage: error.message })
  if (!at) throw createError({ statusCode: 409, statusMessage: 'This visit cannot be checked in to right now' })
  if (before?.checked_in_at) return { checkedInAt: at }

  await afterPatientArrival(serverSupabaseServiceRole<Database>(event), body.appointmentId, getRequestURL(event).origin, 'patient-check-in')
  return { checkedInAt: at }
})
