import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// Sending a Facebook Messenger reply as the clinic's Page.
//
// The same endpoint and envelope Instagram replies use (instagramSend.ts),
// because both are sent THROUGH THE PAGE: POST /me/messages with the Page
// token stored when Instagram was connected. Kept apart rather than shared
// for the reason that file gives: either platform can change its rules
// without the other, and Messenger already differs in one -- it wants the
// message tagged as a RESPONSE to something the person sent.

const graphBase = (): string => useRuntimeConfig().metaGraphBaseUrl

/**
 * Messenger's standard messaging window: 24 hours since the person last
 * wrote. A reply after it is refused unless it carries a message tag, and
 * none of the tags is meant for a clinic answering a question late.
 */
export function messengerWindowOpen(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false
  return Date.now() - new Date(lastInboundAt).getTime() < 24 * 60 * 60 * 1000
}

/** Sends a text reply. Returns Messenger's message id, stored where a wamid would be. */
export async function sendMessengerText(pageToken: string, psid: string, text: string): Promise<string | null> {
  const response = await $fetch<{ message_id?: string }>(`${graphBase()}/me/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pageToken}` },
    body: {
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { text },
    },
  })
  return response.message_id ?? null
}

/**
 * Replies to a Messenger lead: resolves who they are and the Page token,
 * checks the window, sends, and records the row only once Meta accepted it.
 * Shared by the Inbox's send and the receptionist's, so both are held to the
 * same window and leave the same row. Throws with a message a person can act on.
 */
export async function sendMessengerToLead(supabase: SupabaseClient<Database>, accountId: string, leadId: string, text: string, opts: { sentByAi?: boolean } = {}) {
  const { data: lead } = await supabase
    .from('leads')
    .select('external_id, patient_id')
    .eq('id', leadId)
    .eq('account_id', accountId)
    .eq('external_source', 'messenger')
    .is('deleted_at', null)
    .maybeSingle()
  const psid = lead?.external_id
  if (!psid) throw createError({ statusCode: 400, statusMessage: 'That lead did not come from Messenger, so there is no conversation to reply to.' })

  const { data: account } = await supabase
    .from('accounts')
    .select('id, messenger_page_id, instagram_access_token')
    .eq('id', accountId)
    .maybeSingle()
  await withMessagingTokens(accountId, account)
  // The Page token is the one stored when Instagram was connected: the same
  // Page answers both.
  if (!account?.messenger_page_id || !account?.instagram_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'Messenger is not connected. Connect Instagram in Settings > WhatsApp.' })
  }

  // Checked here because Meta's refusal is a bare code, and somebody who has
  // just typed a reply deserves to be told why it cannot go.
  const { data: lastInbound } = await supabase
    .from('whatsapp_messages')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('channel', 'messenger')
    .eq('external_contact_id', psid)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!messengerWindowOpen(lastInbound?.created_at ?? null)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'More than 24 hours since they last wrote, so Messenger will not deliver a reply. They have to message again first.',
    })
  }

  let messageId: string | null = null
  try {
    messageId = await sendMessengerText(account.instagram_access_token, psid, text)
  } catch (err: any) {
    const detail = err?.data?.error?.message ?? err?.message ?? 'Unknown error'
    console.error('[messenger/send] failed:', detail)
    throw createError({ statusCode: 502, statusMessage: `Messenger refused the message: ${detail}` })
  }

  await supabase.from('whatsapp_messages').insert({
    account_id: accountId,
    lead_id: leadId,
    // Converted, their conversation is read from the patient's thread too.
    patient_id: lead?.patient_id ?? null,
    channel: 'messenger',
    direction: 'outbound',
    status: 'sent',
    wamid: messageId,
    external_contact_id: psid,
    body_preview: text.slice(0, 2000),
    ...(opts.sentByAi ? { sent_by_ai: true } : {}),
  })
  return messageId
}
