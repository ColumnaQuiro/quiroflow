import { requireGrowth } from '~/server/utils/requireGrowth'
import { formatEuros } from '~/server/utils/leads'
import type { Database } from '~/types/database.types'

type LeadPreview = Database['public']['Functions']['inbox_lead_previews']['Returns'][number]

// Lead conversations for the Inbox.
//
// These are rows in whatsapp_messages carrying a lead_id -- the same table
// the patient threads come from, which is what makes "one person, one
// thread" true rather than aspirational. The Inbox merges this list into the
// one it already renders.
//
// Only WhatsApp threads exist today. The design also draws Instagram, web
// chat and email; none of them has a transport, an inbound webhook or a
// place to put a message, so no conversation on those channels can exist
// yet and none is invented here.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)

  // One row per lead: its latest message and the lead fields shown below.
  // This used to be the newest 1000 lead messages grouped here, which lost
  // every lead whose last message was older than the 1000th, followed by the
  // leads fetched by id in the URL. See
  // 20260929142012_inbox_counts_and_lead_previews.sql.
  //
  // Paged, because an RPC's rows stop at PostgREST's max_rows (1000) as
  // silently as a select does -- a clinic with more leads than that would
  // have the oldest fall off the end, which is the bug this replaces.
  const PAGE = 1000
  const rows: LeadPreview[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc('inbox_lead_previews', { p_account_id: teamMember.account_id })
      .range(from, from + PAGE - 1)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  const conversations = rows
    .map((lead) => {
      const initials = lead.full_name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')

      return {
        key: `lead:${lead.lead_id}`,
        leadId: lead.lead_id,
        name: lead.full_name,
        initials: initials || '?',
        channel: lead.channel,
        aiState: lead.ai_state,
        takenOverBy: lead.taken_over_by_name ?? null,
        // Unread means the same thing it does for a patient thread: the last
        // message is theirs and nobody has answered since.
        unread: lead.direction === 'inbound',
        lastMessageAt: lead.created_at,
        preview: lead.body_preview ?? '',
        // A dry-run rule records what it WOULD have sent as an outbound row,
        // so the newest row on a lead in test mode is routinely a message
        // nobody received. Unmarked, this list says the clinic said it.
        previewWasNotSent: lead.status === 'would_send',
        // A reply the receptionist wrote and nobody has decided on. Since the
        // tick started writing these unprompted, a draft can appear on a
        // thread nobody opened -- so the list has to say which rows are
        // waiting on a person, or the drafts help only whoever goes looking.
        // The text is not sent: this is a flag, and the list is not where
        // somebody should be reading a reply before approving it.
        hasDraft: lead.has_draft,
        source: lead.source,
        stage: lead.stage,
        value: formatEuros(lead.estimated_value_cents),
        patientId: lead.patient_id,
        phone: lead.phone,
      }
    })
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))

  return { conversations }
})
