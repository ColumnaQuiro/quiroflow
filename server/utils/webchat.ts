import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { insertLead } from '~/server/utils/leads'
import { receptionistHandlesNewLeads } from '~/server/utils/receptionist'

// The chat on a clinic's own website (public/webchat.js).
//
// A visitor is a random id their browser made and keeps in localStorage. It
// is also the only thing that lets them read their conversation back, so it
// is treated as a secret: long, random, never shown on a page that is not
// theirs. It is stored where an Instagram DM keeps its IGSID --
// whatsapp_messages.external_contact_id and the lead's external_id -- so a
// website conversation is a lead conversation like any other, and the Inbox,
// the board and the receptionist need nothing new to read it.

/** 32-64 characters from the widget's alphabet: anything else is not a visitor id the widget made. */
export function isVisitorId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(value)
}

export interface WebchatAccount {
  id: string
  name: string
  webchat_greeting: string | null
}

/**
 * The account behind a website's snippet, or null when there is none or its
 * chat is switched off -- which the caller answers the same way, so the
 * widget cannot tell a clinic that exists from one that does not.
 */
export async function webchatAccountBySlug(supabase: SupabaseClient<Database>, slug: string): Promise<WebchatAccount | null> {
  if (!slug || slug.length > 100) return null
  const { data } = await supabase
    .from('accounts')
    .select('id, name, webchat_enabled, webchat_greeting')
    .eq('slug', slug)
    .maybeSingle()
  if (!data?.webchat_enabled) return null
  return { id: data.id, name: data.name, webchat_greeting: data.webchat_greeting }
}

/** The visitor's lead, or null when they have not written yet. */
export async function webchatLeadId(supabase: SupabaseClient<Database>, accountId: string, visitorId: string): Promise<string | null> {
  const { data } = await supabase
    .from('leads')
    .select('id')
    .eq('account_id', accountId)
    .eq('external_source', 'webchat')
    .eq('external_id', visitorId)
    .is('deleted_at', null)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * The visitor's lead, created on their first message. Named with a suffix
 * until somebody learns their real name, so several visitors are not
 * identical rows on the board. Null only when it could not be written.
 */
export async function leadForWebchatVisitor(supabase: SupabaseClient<Database>, accountId: string, visitorId: string): Promise<string | null> {
  const existing = await webchatLeadId(supabase, accountId, visitorId)
  if (existing) return existing

  const { data: lead, error } = await insertLead(supabase, accountId, {
    full_name: `Visitante web ${visitorId.slice(-4).toUpperCase()}`,
    channel: 'webchat',
    source: 'Web',
    external_source: 'webchat',
    external_id: visitorId,
    stage: 'contacted',
    ...((await receptionistHandlesNewLeads(supabase, accountId)) ? { ai_state: 'handling' as const } : {}),
  })
  if (error) {
    console.error('[webchat] could not create a lead:', error.message)
    return null
  }
  return (lead as { id: string }).id
}

export interface WebchatMessage {
  id: string
  from: 'visitor' | 'clinic'
  text: string
  at: string
}

/** The conversation as the visitor sees it: what they wrote and what the clinic answered, nothing internal. */
export async function webchatConversation(supabase: SupabaseClient<Database>, accountId: string, leadId: string): Promise<WebchatMessage[]> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, body_preview, created_at')
    .eq('account_id', accountId)
    .eq('lead_id', leadId)
    .eq('channel', 'webchat')
    .order('created_at', { ascending: true })
    .limit(200)
  return (data ?? [])
    .filter((m) => (m.body_preview ?? '').trim())
    .map((m) => ({ id: m.id, from: m.direction === 'inbound' ? ('visitor' as const) : ('clinic' as const), text: m.body_preview ?? '', at: m.created_at }))
}

/**
 * Writes a reply into a website conversation -- which is all sending one is:
 * the widget reads it back from here. Shared by the Inbox's send and the
 * receptionist's, so both leave the same row. Throws when the lead did not
 * come from the website chat, and so has no widget to read it.
 */
export async function sendWebchatText(supabase: SupabaseClient<Database>, accountId: string, leadId: string, text: string, opts: { sentByAi?: boolean } = {}) {
  const { data: lead } = await supabase
    .from('leads')
    .select('external_id, patient_id')
    .eq('id', leadId)
    .eq('account_id', accountId)
    .eq('external_source', 'webchat')
    .is('deleted_at', null)
    .maybeSingle()
  if (!lead?.external_id) throw createError({ statusCode: 400, statusMessage: 'That lead did not come from the website chat.' })

  const { error } = await supabase.from('whatsapp_messages').insert({
    account_id: accountId,
    lead_id: leadId,
    // Converted, their conversation is read from the patient's thread too.
    patient_id: lead.patient_id ?? null,
    channel: 'webchat',
    direction: 'outbound',
    status: 'sent',
    external_contact_id: lead.external_id,
    body_preview: text.slice(0, 2000),
    ...(opts.sentByAi ? { sent_by_ai: true } : {}),
  })
  if (error) throw createError({ statusCode: 500, statusMessage: `Could not store the reply: ${error.message}` })
}
