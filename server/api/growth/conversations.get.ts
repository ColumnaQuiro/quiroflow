import { requireGrowth } from '~/server/utils/requireGrowth'
import { formatEuros } from '~/server/utils/leads'

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

  const { data: messages, error } = await supabase
    .from('whatsapp_messages')
    .select('id, lead_id, direction, body_preview, channel, created_at, status')
    .eq('account_id', teamMember.account_id)
    .not('lead_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const byLead = new Map<string, NonNullable<typeof messages>>()
  for (const message of messages ?? []) {
    if (!message.lead_id) continue
    const list = byLead.get(message.lead_id) ?? []
    list.push(message)
    byLead.set(message.lead_id, list)
  }

  if (byLead.size === 0) return { conversations: [] }

  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, phone, source, stage, ai_state, estimated_value_cents, patient_id, ai_taken_over_at, ai_draft_body, team_members:ai_taken_over_by(full_name)')
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .in('id', [...byLead.keys()])

  const conversations = (leads ?? [])
    .map((lead) => {
      // Already ordered newest-first by the query above.
      const thread = byLead.get(lead.id) ?? []
      const last = thread[0]!
      const initials = lead.full_name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')

      return {
        key: `lead:${lead.id}`,
        leadId: lead.id,
        name: lead.full_name,
        initials: initials || '?',
        channel: last.channel,
        aiState: lead.ai_state,
        takenOverBy: lead.team_members?.full_name ?? null,
        // Unread means the same thing it does for a patient thread: the last
        // message is theirs and nobody has answered since.
        unread: last.direction === 'inbound',
        lastMessageAt: last.created_at,
        preview: last.body_preview ?? '',
        // A dry-run rule records what it WOULD have sent as an outbound row,
        // so the newest row on a lead in test mode is routinely a message
        // nobody received. Unmarked, this list says the clinic said it.
        previewWasNotSent: last.status === 'would_send',
        // A reply the receptionist wrote and nobody has decided on. Since the
        // tick started writing these unprompted, a draft can appear on a
        // thread nobody opened -- so the list has to say which rows are
        // waiting on a person, or the drafts help only whoever goes looking.
        // The text is not sent: this is a flag, and the list is not where
        // somebody should be reading a reply before approving it.
        hasDraft: Boolean(lead.ai_draft_body),
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
