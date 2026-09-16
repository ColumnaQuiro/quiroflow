import { sendInstagramText, instagramWindowOpen } from '~/server/utils/instagramSend'

// Replying to an Instagram DM from the Inbox.
//
// Its own route rather than a branch in whatsapp/inbox-send. That route's
// whole body is phone numbers -- E.164 formatting, patient contact numbers,
// lead phones, templates for outside the window -- and none of it means
// anything here. Instagram has no templates and no phone: a recipient is an
// IGSID, and outside the 24h window there is no approved-template escape
// hatch, only a refusal.
//
// What it does share is the message row, so the Inbox reads both channels
// from one table and the thread interleaves correctly.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ recipientId?: string; text?: string }>(event)

  const recipientId = body?.recipientId?.trim()
  const text = body?.text?.trim()
  if (!recipientId) throw createError({ statusCode: 400, statusMessage: 'recipientId is required' })
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text is required' })

  const { supabase, teamMember } = await requirePermission(event, 'inbox_access')

  const { data: account } = await supabase
    .from('accounts')
    .select('id, instagram_user_id, instagram_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.instagram_user_id || !account?.instagram_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'Instagram is not connected. Set it up in Settings > WhatsApp.' })
  }

  // The window is checked here rather than left to Meta because the refusal
  // is worth explaining. Instagram's own error for this is a numeric code,
  // and somebody who has just typed a reply deserves to be told why it
  // cannot go rather than shown it.
  const { data: lastInbound } = await supabase
    .from('whatsapp_messages')
    .select('created_at')
    .eq('account_id', teamMember.account_id)
    .eq('external_contact_id', recipientId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!instagramWindowOpen(lastInbound?.created_at ?? null)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'More than 24 hours since they last wrote, so Instagram will not deliver a reply. They have to message again first.',
    })
  }

  let messageId: string | null = null
  try {
    messageId = await sendInstagramText(
      { instagram_user_id: account.instagram_user_id, instagram_access_token: account.instagram_access_token },
      recipientId,
      text,
    )
  } catch (err: any) {
    // Meta's message names the actual problem -- an expired token, a
    // recipient who blocked the account -- and replacing it with "send
    // failed" costs whoever has to fix it the only clue they had.
    const detail = err?.data?.error?.message ?? err?.message ?? 'Unknown error'
    console.error('[instagram/send] failed:', detail)
    throw createError({ statusCode: 502, statusMessage: `Instagram refused the message: ${detail}` })
  }

  // Recorded only after Meta accepted it. A row written first and a send that
  // failed afterwards is a thread showing a reply the person never received.
  await supabase.from('whatsapp_messages').insert({
    account_id: teamMember.account_id,
    channel: 'instagram',
    direction: 'outbound',
    status: 'sent',
    wamid: messageId,
    external_contact_id: recipientId,
    body_preview: text.slice(0, 2000),
  })

  return { ok: true, messageId }
})
