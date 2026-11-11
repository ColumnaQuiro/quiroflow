import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { inboundNonTextBody, type InboundNonTextMessage } from '~/utils/whatsappInbound'
import { phoneMatches } from '~/utils/phone'
import { downloadMetaMedia, extensionForMimeType, type MediaKind } from '~/server/utils/whatsappSend'
import { findLeadIdByPhone, findPatientIdsByPhone, pickInboundPatientId } from '~/server/utils/whatsappOwner'
import { clearLeadHandover } from '~/server/utils/inboxSend'

// WhatsApp Coexistence: a clinic's number is on the WhatsApp Business app AND
// on the Cloud API at once (see 20261111184500_whatsapp_business_app_coexistence.sql).
// Two webhooks exist only for that arrangement, and both arrive on
// /api/whatsapp/webhook beside ordinary messages:
//
// - smb_message_echoes: something the clinic sent FROM THE PHONE. Without it
//   the Inbox would show the patient's half of a conversation and none of the
//   clinic's, and the receptionist -- which drafts whenever the patient wrote
//   last -- would answer a question somebody had already answered by hand.
// - history: the chats already on the phone, shared once when the number is
//   connected (requested by /api/meta/connect/callback).

type Service = SupabaseClient<Database>
type MessageInsert = Database['public']['Tables']['whatsapp_messages']['Insert']

interface MetaMedia {
  id?: string
  mime_type?: string
  caption?: string
  filename?: string
}

/** A message as both webhooks carry it: echoes and history share the shape. */
export interface CoexistenceMessage extends InboundNonTextMessage {
  id: string
  from: string
  /** Set on an echo, and on a history message the business sent. */
  to?: string
  timestamp?: string
  text?: { body?: string }
  image?: MetaMedia
  video?: MetaMedia
  audio?: MetaMedia
  document?: MetaMedia
  sticker?: MetaMedia
  /** History only: what had happened to it, as the phone knew. */
  history_context?: { status?: string }
}

export interface HistoryChunk {
  metadata?: { phase?: number; chunk_order?: number; progress?: number }
  threads?: { id: string; messages?: CoexistenceMessage[] }[]
  errors?: { code?: number; title?: string }[]
}

interface CoexistenceAccount {
  id: string
  whatsapp_phone_number_id: string | null
  whatsapp_access_token: string | null
}

const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio', 'document', 'sticker']

/** Meta's seconds-since-epoch, as the row's created_at; now when absent or unreadable. */
function createdAtOf(timestamp: string | undefined): string {
  const seconds = Number(timestamp)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
}

function mediaOf(msg: CoexistenceMessage): { kind: MediaKind; media: MetaMedia } | null {
  const kind = MEDIA_KINDS.includes(msg.type as MediaKind) ? (msg.type as MediaKind) : null
  const media = kind ? msg[kind] : undefined
  return kind && media ? { kind, media } : null
}

/** The text a bubble shows for a message that is not media. */
function textOf(msg: CoexistenceMessage): string | null {
  return (msg.text?.body || inboundNonTextBody(msg) || '').slice(0, 2000) || null
}

// ------------------------------------------------------------------- echoes

/**
 * Stores a message the clinic sent from the WhatsApp Business app, as an
 * outbound message by a person -- which is what it is.
 *
 * That one fact is what keeps the receptionist out of a conversation the
 * clinic is having by hand: it drafts only when the patient wrote last
 * (receptionistDraft / patientReplyDraft), and a reply about to go out is held
 * back when "a person" wrote meanwhile (heldBackBeforeSending, which counts any
 * outbound row not sent_by_ai and not a template or automation).
 *
 * Nothing else a QuiroFlow send does happens here: no push, no automation, no
 * lead created for a number nobody knows (the business phone also talks to
 * suppliers and friends). Returns whether the row was new.
 */
export async function storeBusinessAppEcho(service: Service, account: CoexistenceAccount, echo: CoexistenceMessage): Promise<boolean> {
  const to = echo.to
  if (!echo.id || !to) return false

  const { data: existing } = await service.from('whatsapp_messages').select('id').eq('wamid', echo.id).limit(1).maybeSingle()
  if (existing) return false

  // A reaction from the phone is not a message in the thread. Shown on the
  // patient's side it would read as the clinic writing "Ha reaccionado con",
  // and there is no column for the clinic's own reaction to draw it small.
  if (echo.type === 'reaction') return false

  const patientIds = await findPatientIdsByPhone(service, account.id, to)
  const patientId = await pickInboundPatientId(service, account.id, to, patientIds)
  const leadId = patientId ? null : await findLeadIdByPhone(service, account.id, to)

  const insert: MessageInsert = {
    account_id: account.id,
    patient_id: patientId,
    lead_id: leadId,
    phone_number: to,
    wamid: echo.id,
    direction: 'outbound',
    status: 'sent',
    purpose: 'other',
    sent_by_ai: false,
    origin: 'business_app',
    created_at: createdAtOf(echo.timestamp),
    body_preview: null,
  }

  const media = mediaOf(echo)
  if (media) {
    insert.media_type = media.kind
    insert.media_filename = media.media.filename ?? null
    insert.body_preview = media.media.caption?.slice(0, 2000) ?? null
    if (media.media.id && account.whatsapp_access_token && account.whatsapp_phone_number_id) {
      try {
        const { buffer, mimeType } = await downloadMetaMedia(
          { whatsapp_phone_number_id: account.whatsapp_phone_number_id, whatsapp_access_token: account.whatsapp_access_token },
          media.media.id,
        )
        const path = `${account.id}/${echo.id}.${extensionForMimeType(mimeType)}`
        await service.storage.from('whatsapp-media').upload(path, buffer, { contentType: mimeType, upsert: true })
        insert.media_storage_path = path
        insert.media_mime_type = mimeType
      } catch {
        // Recorded as sent with its caption all the same: the clinic did send
        // it, and a missing picture is better than a missing message.
        insert.body_preview = insert.body_preview ?? '(media download failed)'
      }
    }
  } else {
    insert.body_preview = textOf(echo)
  }

  const { error } = await service.from('whatsapp_messages').insert(insert)
  if (error) {
    if (error.code !== '23505') console.error(`[whatsapp] could not store business-app echo ${echo.id} for account ${account.id}: ${error.message}`)
    return false
  }

  if (leadId) await personAnsweredLead(service, account.id, leadId)
  return true
}

/**
 * A person wrote to a lead from the phone. In the Inbox the composer is locked
 * while the receptionist handles a lead, so taking over is an explicit click
 * there; on the phone there is no lock, and writing IS taking over. Left as
 * 'handling', the receptionist would answer the lead's next message in the
 * middle of a conversation a person is having with them.
 *
 * A handover waiting for a person is resolved, exactly as an Inbox reply
 * resolves it (clearLeadHandover). Any other state was a person's choice and
 * stays.
 */
async function personAnsweredLead(service: Service, accountId: string, leadId: string) {
  const { data: taken, error } = await service
    .from('leads')
    .update({ ai_state: 'paused', ai_taken_over_by: null, ai_taken_over_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('account_id', accountId)
    .eq('ai_state', 'handling')
    .select('id')
  if (error) {
    console.error(`[whatsapp] could not pause the receptionist on lead ${leadId} after a reply from the phone: ${error.message}`)
    return
  }
  if (taken?.length) {
    await service.from('lead_events').insert({
      account_id: accountId,
      lead_id: leadId,
      kind: 'conversation',
      title: 'A person took over from the AI',
      detail: 'Replied from the WhatsApp Business app',
    })
    return
  }
  await clearLeadHandover(service, accountId, leadId)
}

// ------------------------------------------------------------------ history

/**
 * The phone's existing chats, in chunks, as Meta shares them after a
 * Coexistence connection. Each message is stored once (its wamid is unique),
 * with origin 'history', and nothing is done about any of it: it is the past,
 * already dealt with on the phone.
 *
 * Only threads with somebody QuiroFlow knows -- a patient, or a lead already
 * on the board. Six months of a clinic phone is also the plumber, the
 * accountant and a family group, and filing all of that into the Inbox as
 * strangers' conversations would bury the ones that matter. Somebody unknown
 * who writes again arrives as an ordinary message and becomes a lead then.
 *
 * Each imported conversation is marked read for the team, up to its newest
 * imported message. Otherwise every thread whose last word was the patient's
 * would arrive unread, all at once.
 */
export async function importWhatsAppHistory(service: Service, accountId: string, chunk: HistoryChunk): Promise<{ imported: number; skippedThreads: number }> {
  for (const err of chunk.errors ?? []) {
    // 2593109: the clinic chose not to share their history in the app.
    console.warn(`[whatsapp] account ${accountId}: no chat history from the WhatsApp Business app (${err.code ?? '?'}: ${err.title ?? 'no reason given'})`)
  }
  const threads = chunk.threads ?? []
  if (threads.length === 0) return { imported: 0, skippedThreads: 0 }

  const owners = await ownerResolver(service, accountId)
  let imported = 0
  let skippedThreads = 0

  for (const thread of threads) {
    const phone = thread.id
    const owner = phone ? await owners(phone) : null
    if (!owner) {
      skippedThreads++
      continue
    }

    const rows: MessageInsert[] = []
    for (const msg of thread.messages ?? []) {
      if (!msg.id || msg.type === 'reaction') continue
      // The business's own messages are the ones not from the contact. Read
      // that way round because `to` is only promised on the business's side.
      const outbound = msg.from !== phone
      const media = mediaOf(msg)
      rows.push({
        account_id: accountId,
        patient_id: owner.patientId,
        lead_id: owner.leadId,
        phone_number: phone,
        wamid: msg.id,
        direction: outbound ? 'outbound' : 'inbound',
        status: outbound ? historyStatus(msg.history_context?.status) : 'received',
        purpose: outbound ? 'other' : null,
        sent_by_ai: false,
        origin: 'history',
        created_at: createdAtOf(msg.timestamp),
        // Media is not downloaded: Meta only keeps it for 14 days, a chunk
        // can hold hundreds, and the webhook has seconds. The caption, or a
        // placeholder, says something was there.
        media_type: media?.kind ?? null,
        media_filename: media?.media.filename ?? null,
        body_preview: media ? (media.media.caption?.slice(0, 2000) ?? '(media not imported)') : textOf(msg),
      })
    }
    if (rows.length === 0) continue

    imported += await insertNew(service, rows)

    const newest = rows.reduce((max, r) => (r.created_at! > max ? r.created_at! : max), rows[0]!.created_at!)
    await markReadForTeam(service, accountId, owner.patientId ?? `lead:${owner.leadId}`, newest)
  }

  return { imported, skippedThreads }
}

/** The phone's tick for a message, as a status the thread can draw. */
function historyStatus(status: string | undefined): string {
  const s = (status ?? '').toLowerCase()
  if (s === 'read' || s === 'played') return 'read'
  if (s === 'delivered') return 'delivered'
  if (s === 'error' || s === 'failed') return 'failed'
  return 'sent'
}

/**
 * Who a phone number belongs to, for many numbers in a row. The per-message
 * helpers read every contact number on the account for each lookup, which is
 * right for one message and wrong for a few hundred threads, so the numbers
 * and the leads are read once per chunk and matched here.
 */
async function ownerResolver(service: Service, accountId: string) {
  const contacts: { patient_id: string; number: string; country_code: string }[] = []
  const PAGE = 1000
  for (let page = 0; ; page++) {
    const { data } = await service
      .from('patient_contact_numbers')
      .select('patient_id, number, country_code')
      .eq('account_id', accountId)
      .range(page * PAGE, page * PAGE + PAGE - 1)
    contacts.push(...((data ?? []) as typeof contacts))
    if (!data || data.length < PAGE) break
  }
  const { data: leads } = await service
    .from('leads')
    .select('id, phone')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .not('phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  return async (phone: string): Promise<{ patientId: string | null; leadId: string | null } | null> => {
    const patientIds = contacts.filter((c) => phoneMatches(c.number, c.country_code, phone)).map((c) => c.patient_id)
    if (patientIds.length > 0) {
      const patientId = await pickInboundPatientId(service, accountId, phone, patientIds)
      if (patientId) return { patientId, leadId: null }
    }
    const digits = phone.replace(/\D/g, '')
    const lead = (leads ?? []).find((l) => l.phone && phoneMatches(l.phone, 'ES', digits))
    return lead ? { patientId: null, leadId: lead.id } : null
  }
}

/** Inserts the rows not already stored, and returns how many went in. */
async function insertNew(service: Service, rows: MessageInsert[]): Promise<number> {
  const { data: have } = await service
    .from('whatsapp_messages')
    .select('wamid')
    .in('wamid', rows.map((r) => r.wamid!))
  const stored = new Set((have ?? []).map((r) => r.wamid))
  const fresh = rows.filter((r) => !stored.has(r.wamid!))
  if (fresh.length === 0) return 0

  const { error } = await service.from('whatsapp_messages').insert(fresh)
  if (!error) return fresh.length
  // Meta redelivering the same chunk at the same moment: one of the rows went
  // in meanwhile. One at a time, so the rest are not lost with it.
  if (error.code !== '23505') {
    console.error(`[whatsapp] could not import ${fresh.length} history message(s): ${error.message}`)
    return 0
  }
  let n = 0
  for (const row of fresh) {
    const { error: one } = await service.from('whatsapp_messages').insert(row)
    if (!one) n++
  }
  return n
}

/** Moves each team member's read mark on a conversation forward to `at`, never back. */
async function markReadForTeam(service: Service, accountId: string, conversationKey: string, at: string) {
  const { data: members } = await service.from('team_members').select('id').eq('account_id', accountId)
  const ids = (members ?? []).map((m) => m.id)
  if (ids.length === 0) return
  const { data: reads } = await service.from('inbox_reads').select('team_member_id, last_read_at').eq('conversation_key', conversationKey).in('team_member_id', ids)
  const readAt = new Map((reads ?? []).map((r) => [r.team_member_id, r.last_read_at]))
  const behind = ids.filter((id) => {
    const seen = readAt.get(id)
    return !seen || new Date(seen).getTime() < new Date(at).getTime()
  })
  if (behind.length === 0) return
  const { error } = await service
    .from('inbox_reads')
    .upsert(behind.map((id) => ({ account_id: accountId, team_member_id: id, conversation_key: conversationKey, last_read_at: at })), { onConflict: 'team_member_id,conversation_key' })
  if (error) console.error(`[whatsapp] could not mark imported conversation ${conversationKey} read: ${error.message}`)
}
