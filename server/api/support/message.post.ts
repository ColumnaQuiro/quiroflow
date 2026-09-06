import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requireTeamMember } from '~/server/utils/requirePermission'

// Escalation from the help widget: the assistant couldn't answer (or the
// user didn't want it to), so the question becomes a real support thread for
// someone on the QuiroFlow team to answer from the admin panel.
//
// Writes run as service role, not the caller's client, because posting a
// message has to set fields a clinic deliberately cannot set for itself --
// admin_unread and status decide whether we still owe them an answer, and
// 0148's column grant limits `authenticated` to clinic_unread precisely so a
// clinic can't quietly take itself out of our queue. Every statement below
// is therefore pinned to the caller's own account_id, which requireTeamMember
// resolved from their session rather than anything in the request body.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireTeamMember(event)
  const db = serverSupabaseServiceRole<Database>(event)

  const body = await readBody<{ conversationId?: string; message?: string }>(event)
  const message = (body?.message ?? '').trim()
  if (!message) throw createError({ statusCode: 400, statusMessage: 'A message is required' })
  if (message.length > 5000) throw createError({ statusCode: 400, statusMessage: 'That message is too long' })

  const now = new Date().toISOString()
  let conversationId = body?.conversationId ?? null

  if (conversationId) {
    // The account_id filter is what stops a guessed id from another clinic
    // being written to -- service role has no RLS to fall back on here.
    const { data: updated, error: updateError } = await db
      .from('support_conversations')
      .update({ status: 'open', admin_unread: true, last_message_at: now })
      .eq('id', conversationId)
      .eq('account_id', teamMember.account_id)
      .select('id')
      .maybeSingle()
    if (updateError) throw createError({ statusCode: 400, statusMessage: updateError.message })
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  } else {
    const { data: conversation, error: insertError } = await db
      .from('support_conversations')
      .insert({
        account_id: teamMember.account_id,
        opened_by_team_member_id: teamMember.id,
        // The list in the admin panel needs something to show per row, and
        // the first question is the most useful thing it could be.
        subject: message.length > 120 ? `${message.slice(0, 117)}…` : message,
        last_message_at: now,
      })
      .select('id')
      .single()
    if (insertError || !conversation) {
      throw createError({ statusCode: 400, statusMessage: insertError?.message ?? 'Could not start the conversation' })
    }
    conversationId = conversation.id
  }

  const { error: messageError } = await db.from('support_messages').insert({
    conversation_id: conversationId,
    account_id: teamMember.account_id,
    direction: 'from_clinic',
    body: message,
    author_team_member_id: teamMember.id,
  })
  if (messageError) throw createError({ statusCode: 400, statusMessage: messageError.message })

  return { conversationId }
})
