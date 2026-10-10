import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import type { BusinessHours } from '~/utils/businessHours'
import { sendPushToUsers } from '~/server/utils/pushNotifications'
import { wantingPush } from '~/server/utils/staffPush'

// After an internal Inbox note is saved (inbox_notes), a push to each
// colleague it @mentions: "Ana te ha mencionado" and the note, opening the
// conversation. Fire-and-forget from both Inboxes; the note is already saved,
// and the mention already marked the conversation unread for them (the
// table's trigger), which is what holds even with pushes off.
//
// Only the note's own author can ask, once it exists: the note is read
// through their own client, so RLS is what proves it is theirs and in their
// account. Each person's Avisos decide, under "inbox" (staffPush.ts).
export default defineEventHandler(async (event) => {
  const { noteId } = await readBody<{ noteId?: string }>(event)
  if (!noteId || typeof noteId !== 'string') throw createError({ statusCode: 400, statusMessage: 'noteId is required' })

  const { supabase, teamMember } = await requirePermission(event, 'inbox_access')
  const { data: note } = await supabase.from('inbox_notes').select('id, account_id, conversation_key, author_id, body, mentions').eq('id', noteId).maybeSingle()
  if (!note || note.author_id !== teamMember.id || note.account_id !== teamMember.account_id) throw createError({ statusCode: 404, statusMessage: 'Note not found' })
  const mentioned = (note.mentions ?? []).filter((id) => id !== teamMember.id)
  if (mentioned.length === 0) return { sent: 0 }

  const service = serverSupabaseServiceRole<Database>(event)
  const [{ data: members }, { data: author }, { data: clinic }] = await Promise.all([
    service.from('team_members').select('id, user_id, business_hours').eq('account_id', note.account_id).in('id', mentioned).is('deleted_at', null),
    service.from('team_members').select('full_name').eq('id', teamMember.id).maybeSingle(),
    service.from('clinics').select('timezone, business_hours').eq('account_id', note.account_id).is('archived_at', null).order('name').limit(1).maybeSingle(),
  ])
  const userIds = await wantingPush(
    service,
    ((members ?? []) as { id: string; user_id: string | null; business_hours: BusinessHours | null }[]),
    'inbox',
    clinic as { timezone: string | null; business_hours: BusinessHours | null } | null,
  )
  const who = (author as { full_name: string } | null)?.full_name ?? 'Un compañero'
  const body = note.body.length > 140 ? `${note.body.slice(0, 139)}…` : note.body
  const result = await sendPushToUsers(service, userIds, { title: `${who} te ha mencionado`, body, data: { type: 'inbox', key: note.conversation_key } })
  return { sent: result.delivered }
})
