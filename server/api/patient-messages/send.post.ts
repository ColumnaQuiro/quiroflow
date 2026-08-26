import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { notifyInboxTeamMembers } from '~/server/utils/pushNotifications'

// The in-app messaging channel: a signed-in patient messaging the clinic
// directly (mobile app today), and staff replying from the Inbox -- both
// go through this one endpoint rather than a raw client insert, because
// the "a patient sent a message, notify the team" push needs a server-side
// step regardless, and keeping both directions in one place makes the
// direction-derivation below the single source of truth for it instead of
// trusting whatever the client claims.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId?: string; text?: string }>(event)
  if (!body?.patientId || !body.text?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'patientId and text are required' })
  }

  const { supabase, user } = await requireAuthedUser(event)

  const { data: patient } = await supabase.from('patients').select('id, account_id, user_id, first_name, last_name').eq('id', body.patientId).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  // Not trusted from the client: a team member of the patient's account
  // replying is outbound, the patient themselves messaging in is inbound.
  // Whoever this signed-in user actually is, patient_app_messages' RLS
  // insert policies (0085_patient_app_messages.sql) independently enforce
  // the same rule -- this just has to derive the same answer, or the
  // insert below fails on its own.
  const direction = patient.user_id === user.id ? 'inbound' : 'outbound'

  const text = body.text.trim().slice(0, 4000)
  const { error } = await supabase.from('patient_app_messages').insert({ account_id: patient.account_id, patient_id: patient.id, direction, body: text } as never)
  if (error) throw createError({ statusCode: 403, statusMessage: 'Not authorized to message this patient' })

  if (direction === 'inbound') {
    const serviceSupabase = serverSupabaseServiceRole<Database>(event)
    const senderName = `${patient.first_name} ${patient.last_name ?? ''}`.trim()
    await notifyInboxTeamMembers(event, serviceSupabase, patient.account_id, senderName, text, { type: 'patient_app_message', key: patient.id })
  }

  return { success: true }
})
