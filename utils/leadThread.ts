// One lead's conversation: the messages, and the context a person needs
// beside them to answer well. Read by the Inbox straight from the browser
// (useGrowthLeadThread), as a patient thread is, and by
// /api/growth/leads/[id]/thread for anything that still asks the server.
//
// It used to be the server route alone, so every lead opened in the Inbox
// went browser -> Netlify function -> database and back, and a function that
// had been idle took a cold start on top. The rows it reads are the user's
// own to read under RLS -- leads and receptionist_config to any member of
// the account, the messages with Inbox access -- so the browser gets exactly
// what the route did; the route's Growth check is what decides whether lead
// rows reach the Inbox to be opened at all (/api/growth/conversations).
//
// Relative imports only: the staff app auto-imports this directory too.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { LeadThread } from '../composables/useGrowthLeadThread'

function euros(cents: number | null) {
  if (cents === null) return null
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)
}

/** The lead's thread, or null when there is no such lead in the account. Throws when it cannot be read. */
export async function readLeadThread(supabase: SupabaseClient<Database>, leadId: string, accountId: string): Promise<LeadThread | null> {
  // The lead, its messages and the receptionist setting do not depend on one
  // another, so they are read together. The messages are keyed by the lead id
  // and scoped by RLS, and are only used once the lead itself is found.
  const [{ data: lead, error }, { data: newest, error: messagesError }, { data: receptionist }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, full_name, phone, email, channel, source, stage, estimated_value_cents, ai_state, patient_id, ai_taken_over_at, ai_draft_body, ai_draft_created_at, clinics:clinic_id(name), team_members:ai_taken_over_by(full_name)')
      .eq('id', leadId)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .maybeSingle(),
    // The NEWEST 200, shown oldest first. Ascending with a limit returned the
    // first 200 ever, so a long conversation lost exactly the messages
    // someone was about to answer.
    supabase
      .from('whatsapp_messages')
      .select('id, direction, body_preview, channel, status, created_at, template_name, media_type, media_storage_path, media_filename, sent_by_ai')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(200),
    // Whether the receptionist may work on real conversations, so the thread
    // can decide about the draft button rather than offering one the server
    // would refuse.
    supabase.from('receptionist_config').select('enabled').eq('account_id', accountId).maybeSingle(),
  ])
  if (error || messagesError) throw error ?? messagesError
  if (!lead) return null

  const messages = [...(newest ?? [])].reverse()

  // Photos, voice notes and documents a lead sends, signed so they show
  // rather than arriving as empty bubbles. Only what is actually known about
  // this person beside them: a lead has no visit history and no balance --
  // that is what being a lead means -- so those are absent rather than
  // rendered as zeroes that look like facts. Both need the lead, neither
  // needs the other.
  const mediaPaths = [...new Set(messages.map((m) => m.media_storage_path).filter((p): p is string => !!p))]
  const [signed, patient] = await Promise.all([
    mediaPaths.length ? supabase.storage.from('whatsapp-media').createSignedUrls(mediaPaths, 60 * 30) : null,
    lead.patient_id ? supabase.from('patients').select('id, balance_cents').eq('id', lead.patient_id).maybeSingle() : null,
  ])
  const mediaUrls: Record<string, string> = {}
  for (const row of signed?.data ?? []) if (row.path && row.signedUrl) mediaUrls[row.path] = row.signedUrl

  // The 24h customer-service window decides whether a free-text reply is even
  // possible, so the composer needs to know before it lets someone type a
  // message WhatsApp will refuse.
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound')
  const withinWindow = lastInbound ? Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 3600 * 1000 : false

  return {
    id: lead.id,
    name: lead.full_name,
    phone: lead.phone,
    email: lead.email,
    // Which way a reply has to go out. An Instagram lead has no phone at all,
    // so a composer that assumes WhatsApp sends it to a route whose entire
    // body is phone numbers and gets a 400 back.
    channel: lead.channel,
    source: lead.source,
    stage: lead.stage,
    value: euros(lead.estimated_value_cents),
    aiState: lead.ai_state as LeadThread['aiState'],
    takenOverBy: lead.team_members?.full_name ?? null,
    takenOverAt: lead.ai_taken_over_at,
    clinic: lead.clinics?.name ?? null,
    patientId: lead.patient_id,
    patientBalance: patient?.data ? euros(patient.data.balance_cents) : null,
    canReplyFreeText: withinWindow,
    // A reply the receptionist wrote, waiting on a person. Sent separately
    // with its own timestamp so the Inbox can say how stale it is: a draft
    // written before the patient said three more things is worth re-reading
    // rather than approving on sight.
    draft: lead.ai_draft_body,
    draftAt: lead.ai_draft_created_at,
    receptionistEnabled: receptionist?.enabled ?? false,
    messages: messages.map((message) => ({
      id: message.id,
      // A lead's own messages are inbound; everything outbound came from the
      // clinic -- a person, or the AI receptionist answering on its own
      // (sentByAi), which the thread labels for the team. Never the lead.
      from: message.direction === 'inbound' ? ('lead' as const) : ('clinic' as const),
      sentByAi: message.sent_by_ai === true,
      text: message.body_preview ?? '',
      channel: message.channel,
      status: message.status,
      at: message.created_at,
      templateName: message.template_name,
      mediaType: message.media_type,
      mediaUrl: message.media_storage_path ? (mediaUrls[message.media_storage_path] ?? null) : null,
      mediaFilename: message.media_filename,
    })),
  }
}
