import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPushToPatients } from '~/server/utils/pushNotifications'

// A clinic pushing a notification to its own patients -- either everyone
// (an announcement: closed Friday, a new practitioner) or a named few.
//
// One endpoint for both rather than a broadcast route and a targeted route,
// because the only thing that differs is the recipient list, while
// everything that matters -- who is allowed to send, what gets suppressed,
// what gets written to the log -- is identical and should not have two
// implementations that can drift apart.
//
// Goes through the server rather than the client because it needs the
// service role to read device tokens across patients, and because a message
// that lands on every patient's lock screen at once, with no way to recall
// it, should leave a record of who sent it.
const MAX_TITLE = 64
const MAX_BODY = 300

export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'communication_config')

  const body = await readBody<{ title?: string; body?: string; patientIds?: string[] }>(event)
  const title = body?.title?.trim() ?? ''
  const message = body?.body?.trim() ?? ''
  if (!title || !message) {
    throw createError({ statusCode: 400, statusMessage: 'title and body are required' })
  }
  if (title.length > MAX_TITLE || message.length > MAX_BODY) {
    // Not arbitrary: Android collapses a notification past roughly this
    // length and iOS truncates it, so anything longer is written but never
    // read. Rejecting beats silently delivering half a sentence.
    throw createError({ statusCode: 400, statusMessage: `Keep the title under ${MAX_TITLE} characters and the message under ${MAX_BODY}` })
  }

  // null means everyone; an explicit empty array is a caller bug, not a
  // request to message the whole clinic.
  const patientIds = Array.isArray(body?.patientIds) ? body.patientIds : null
  if (patientIds !== null && patientIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'patientIds was empty -- omit it to send to everyone' })
  }

  const serviceSupabase = serverSupabaseServiceRole<Database>(event)

  // Scoped to the caller's own account, so a patient id from somewhere else
  // pushes to nobody rather than to a stranger.
  const result = await sendPushToPatients(serviceSupabase, teamMember.account_id, patientIds, {
    title,
    body: message,
    data: { type: 'clinic_announcement' },
  })

  await serviceSupabase.from('patient_push_broadcasts').insert({
    account_id: teamMember.account_id,
    sent_by: teamMember.id,
    title,
    body: message,
    patient_ids: patientIds,
    recipients_count: result.recipients,
    delivered_count: result.delivered,
  })

  // recipients is people, delivered is devices -- one patient with a phone
  // and a tablet is 1 and 2. The UI says so rather than implying a failure
  // when the numbers differ.
  return { recipients: result.recipients, devices: result.attempted, delivered: result.delivered }
})
