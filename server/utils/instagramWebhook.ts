import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { webhookMayActOnAccount, type WebhookAuth } from '~/server/utils/whatsappWebhookAuth'
import { notifyInboxTeamMembers } from '~/server/utils/pushNotifications'

// Instagram DMs arriving on the shared webhook.
//
// Same endpoint and same signature check as WhatsApp -- one Meta app, one app
// secret, two products -- but a different payload: messages hang off
// entry[].messaging[] rather than entry[].changes[], the sender is an IGSID
// rather than a phone number, and there are no delivery statuses.
//
// Kept out of webhook.post.ts's loop rather than folded into it. That loop is
// built around value.metadata.phone_number_id, and every line of it would
// need an `if` to serve both.

export interface InstagramMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    /** Set on the clinic's own messages echoed back to us. */
    is_echo?: boolean
    attachments?: { type?: string }[]
  }
}

interface InstagramEntry {
  id?: string
  messaging?: InstagramMessagingEvent[]
}

/**
 * Records every Instagram message in these entries.
 *
 * Returns how many events could not be verified, so the caller can answer
 * 401 and have Meta redeliver rather than dropping them silently -- the same
 * decision the WhatsApp path makes, for the same reason.
 */
export async function handleInstagramEntries(
  supabase: SupabaseClient<Database>,
  entries: InstagramEntry[],
  auth: WebhookAuth,
  rawBody: Buffer,
): Promise<{ stored: number; unverified: number }> {
  let stored = 0
  let unverified = 0

  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      // The clinic's own outgoing messages come back as echoes. Storing them
      // would duplicate every reply the Inbox already recorded when it sent
      // it, and would file the clinic as the person who wrote in.
      if (event.message?.is_echo) continue

      const senderId = event.sender?.id
      // recipient is the clinic's Instagram account -- which clinic this is
      // for. Taken from the payload and then verified, never trusted: the
      // same order the WhatsApp path uses for phone_number_id.
      const igUserId = event.recipient?.id
      if (!senderId || !igUserId) continue

      const { data: account } = await supabase
        .from('accounts')
        .select('id, instagram_user_id')
        .eq('instagram_user_id', igUserId)
        .maybeSingle()
      // A silent skip rather than an error: an id we do not know is not ours
      // to answer for, and saying so would tell a forger which ids exist.
      if (!account) continue

      if (!(await webhookMayActOnAccount(auth, account.id, rawBody, supabase))) {
        console.error(`[instagram] rejected an unverified webhook for account ${account.id} (${auth.kind} auth).`)
        unverified++
        continue
      }

      const text = (event.message?.text ?? '').trim()
      const attachment = event.message?.attachments?.[0]?.type
      // An attachment with no text is still a message somebody sent, and a
      // thread that silently skips it reads as if they said nothing.
      const preview = text || (attachment ? `(${attachment})` : '')
      if (!preview) continue

      const { error } = await supabase.from('whatsapp_messages').insert({
        account_id: account.id,
        channel: 'instagram',
        direction: 'inbound',
        status: 'received',
        // Instagram's own message id, in the column that already holds the
        // channel's id and is uniquely indexed -- so a redelivery, which Meta
        // does whenever we answer anything but 200, stores nothing twice.
        wamid: event.message?.mid ?? null,
        external_contact_id: senderId,
        body_preview: preview.slice(0, 2000),
      })

      // A duplicate is the expected outcome of a redelivery, not a problem:
      // the unique index did its job. Anything else is worth knowing about.
      if (error && !error.message.includes('duplicate key')) {
        console.error('[instagram] could not store a message:', error.message)
        continue
      }
      if (!error) stored++

      await notifyInboxTeamMembers(supabase, account.id, 'Instagram', preview.slice(0, 120), {
        channel: 'instagram',
      })
    }
  }

  return { stored, unverified }
}
