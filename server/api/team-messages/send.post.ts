import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import type { BusinessHours } from '~/utils/businessHours'
import { teamPushPlan } from '~/utils/teamMessages'

// Sends a message to a colleague or to the whole team, or raises an alert
// (see 20261020074859_team_messages.sql), and pushes it.
//
// The row is written with the SENDER's client, so the insert policy is what
// decides who may send as whom and to whom -- this route adds nothing to that
// but the push, which needs the service role (device_push_tokens is each
// user's own).
//
// Messages follow each person's Inbox push switch and quiet hours, like a
// patient's message does. An alert does not: whoever pressed it may be in
// trouble, and a colleague's "outside my hours" is not a reason to stay
// silent about it.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireActiveAccount(event)
  const body = await readBody<{ recipientId?: string | null; body?: string; kind?: 'message' | 'alert'; clinicId?: string | null; roomId?: string | null }>(event)

  const kind = body?.kind === 'alert' ? 'alert' : 'message'
  const text = (body?.body ?? '').trim()
  if (!text) throw createError({ statusCode: 400, statusMessage: 'A message needs some text.' })
  if (text.length > 2000) throw createError({ statusCode: 400, statusMessage: 'Messages are limited to 2,000 characters.' })
  const recipientId = kind === 'alert' ? null : (body?.recipientId ?? null)

  const { data: row, error } = await supabase
    .from('team_messages')
    .insert({
      account_id: teamMember.account_id,
      sender_id: teamMember.id,
      recipient_id: recipientId,
      kind,
      body: text,
      clinic_id: body?.clinicId ?? null,
      room_id: body?.roomId ?? null,
    })
    .select('id, created_at')
    .single()
  if (error || !row) throw createError({ statusCode: 400, statusMessage: error?.message ?? 'Could not send the message.' })

  const service = serverSupabaseServiceRole<Database>(event)
  const [{ data: members }, { data: room }] = await Promise.all([
    service.from('team_members').select('id, user_id, full_name, business_hours').eq('account_id', teamMember.account_id).is('deleted_at', null),
    body?.roomId ? service.from('calendar_resources').select('name').eq('id', body.roomId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const plan = teamPushPlan({
    kind,
    senderId: teamMember.id,
    recipientId,
    members: (members ?? []).map((m) => ({ id: m.id, user_id: m.user_id })),
  })
  if (plan.userIds.length > 0) {
    let userIds = plan.userIds
    if (plan.respectPreferences) {
      const { data: clinic } = await service.from('clinics').select('timezone, business_hours').eq('account_id', teamMember.account_id).is('archived_at', null).order('name').limit(1).maybeSingle()
      userIds = await wantingPush(
        service,
        (members ?? []).filter((m) => m.user_id && plan.userIds.includes(m.user_id)).map((m) => ({ id: m.id, user_id: m.user_id, business_hours: m.business_hours as BusinessHours | null })),
        'inbox',
        clinic as { timezone: string | null; business_hours: BusinessHours | null } | null,
      )
    }
    const senderName = (members ?? []).find((m) => m.id === teamMember.id)?.full_name ?? ''
    const title =
      kind === 'alert'
        ? `🚨 ${senderName}${room?.name ? ` · ${room.name}` : ''}`
        : recipientId
          ? senderName
          : `${senderName} · Equipo`
    // Fire and forget would lose the push on a serverless function that
    // stops at the response, so it is awaited; it never fails the send.
    await sendPushToUsers(service, userIds, {
      title,
      body: text.slice(0, 180),
      data: { type: 'team', url: `/team-chat?thread=${recipientId ? teamMember.id : 'team'}` },
    }).catch((err) => console.error('[team-messages] push failed', err))
  }

  return { id: row.id, createdAt: row.created_at }
})
