import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { webhookMayActOnAccount, type WebhookAuth } from '~/server/utils/whatsappWebhookAuth'
import { notifyInboxTeamMembers } from '~/server/utils/pushNotifications'
import { insertLead } from '~/server/utils/leads'
import { receptionistHandlesNewLeads } from '~/server/utils/receptionist'
import type { InstagramMessagingEvent } from '~/server/utils/instagramWebhook'

// Facebook Messenger DMs to a clinic's Page, arriving on the shared webhook as
// object 'page' -- the same object lead ads use, told apart by shape:
// lead ads hang off entry[].changes[], messages off entry[].messaging[].
//
// The Page is the one connected for Instagram (accounts.messenger_page_id).
// Connecting Instagram subscribes that Page to `messages`, so these were
// being delivered before anything here read them: the Page pass only looked
// at lead ads, and a Messenger conversation was dropped without a word.
//
// Mirrors instagramWebhook.ts on purpose: the same payload envelope, the same
// "located from the body, then verified" order, the same lead per sender.

interface MessengerEntry {
  id?: string
  messaging?: InstagramMessagingEvent[]
}

const graphBase = (): string => useRuntimeConfig().metaGraphBaseUrl

export async function handleMessengerEntries(
  supabase: SupabaseClient<Database>,
  entries: MessengerEntry[],
  auth: WebhookAuth,
  rawBody: Buffer,
): Promise<{ stored: number; unverified: number }> {
  let stored = 0
  let unverified = 0
  const alreadyReported = new Set<string>()

  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      // The Page's own replies, echoed back. Recorded already when they were sent.
      if (event.message?.is_echo) continue
      // Read receipts, deliveries and postbacks share the array; only a
      // message is something somebody said.
      if (!event.message) continue

      const senderId = event.sender?.id
      const pageId = event.recipient?.id ?? entry.id
      if (!senderId || !pageId) continue

      // Not .maybeSingle(), for the reason instagramWebhook.ts gives.
      const { data: matches, error: lookupError } = await supabase
        .from('accounts')
        .select('id, instagram_access_token')
        .eq('messenger_page_id', pageId)
        .limit(2)
      for (const match of matches ?? []) await withMessagingTokens(match.id, match)
      if (lookupError) {
        console.error(`[messenger] could not look up the account for Page ${pageId}: ${lookupError.message}`)
        continue
      }
      if (matches.length > 1) {
        if (!alreadyReported.has(pageId)) {
          alreadyReported.add(pageId)
          console.error(`[messenger] Page ${pageId} is claimed by ${matches.length} accounts. Dropping its messages until one is cleared -- accounts_messenger_page_id_key should have prevented this.`)
        }
        continue
      }
      const account = matches[0]
      if (!account) {
        // A Page subscribed for lead ads only, or connected before Messenger
        // was read: worth one line, not one per message.
        if (!alreadyReported.has(pageId)) {
          alreadyReported.add(pageId)
          console.warn(`[messenger] no account has Page ${pageId} as its Messenger Page. Dropping its message(s).`)
        }
        continue
      }

      if (!(await webhookMayActOnAccount(auth, account.id, rawBody, supabase))) {
        console.error(`[messenger] rejected an unverified webhook for account ${account.id} (${auth.kind} auth).`)
        unverified++
        continue
      }

      const text = (event.message.text ?? '').trim()
      const attachment = event.message.attachments?.[0]?.type
      const preview = text || (attachment ? `(${attachment})` : '')
      if (!preview) continue

      const leadId = await leadForMessengerSender(supabase, account.id, senderId, account.instagram_access_token)

      const { error } = await supabase.from('whatsapp_messages').insert({
        account_id: account.id,
        lead_id: leadId,
        channel: 'messenger',
        direction: 'inbound',
        status: 'received',
        // Messenger's own id, uniquely indexed: a redelivery stores nothing twice.
        wamid: event.message.mid ?? null,
        external_contact_id: senderId,
        body_preview: preview.slice(0, 2000),
      })
      if (error) {
        if (error.code !== '23505') console.error('[messenger] could not store a message:', error.message)
        continue
      }
      stored++

      await notifyInboxTeamMembers(supabase, account.id, 'Messenger', preview.slice(0, 120), {
        channel: 'messenger',
        key: leadId ? `lead:${leadId}` : senderId,
      })
    }
  }

  return { stored, unverified }
}

/** The sender's name as Facebook gives it to the Page. Best-effort, never throws. */
async function fetchMessengerName(psid: string, pageToken: string): Promise<string | null> {
  try {
    const profile = await $fetch<{ name?: string; first_name?: string; last_name?: string }>(`${graphBase()}/${psid}`, {
      query: { fields: 'name,first_name,last_name', access_token: pageToken },
      timeout: 5_000,
    })
    const name = (profile.name ?? [profile.first_name, profile.last_name].filter(Boolean).join(' ')).trim()
    return name || null
  } catch (err: any) {
    console.error('[messenger] could not read the sender profile:', err?.data?.error?.message ?? err?.message ?? err)
    return null
  }
}

const PLACEHOLDER = 'Messenger user'

/**
 * The lead for this Messenger sender, created the first time they write --
 * which is what puts them on the board and in front of the receptionist.
 * Null only when the lead could not be written; the message is stored anyway.
 */
export async function leadForMessengerSender(
  supabase: SupabaseClient<Database>,
  accountId: string,
  psid: string,
  pageToken: string | null,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('leads')
    .select('id, full_name')
    .eq('account_id', accountId)
    .eq('external_source', 'messenger')
    .eq('external_id', psid)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    if (pageToken && existing.full_name.startsWith(PLACEHOLDER)) {
      const name = await fetchMessengerName(psid, pageToken)
      if (name) await supabase.from('leads').update({ full_name: name }).eq('id', existing.id).eq('account_id', accountId)
    }
    return existing.id
  }

  const name = pageToken ? await fetchMessengerName(psid, pageToken) : null
  const { data: lead, error } = await insertLead(supabase, accountId, {
    // Suffixed so several unnamed senders can be told apart on the board.
    full_name: name ?? `${PLACEHOLDER} ${psid.slice(-4)}`,
    channel: 'messenger',
    source: 'Facebook',
    external_source: 'messenger',
    external_id: psid,
    stage: 'contacted',
    ...((await receptionistHandlesNewLeads(supabase, accountId)) ? { ai_state: 'handling' as const } : {}),
  })
  if (error) {
    console.error('[messenger] could not create a lead:', error.message)
    return null
  }
  return (lead as { id: string }).id
}
