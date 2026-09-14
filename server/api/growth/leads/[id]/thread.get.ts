import { requirePermission } from '~/server/utils/requirePermission'
import { formatEuros } from '~/server/utils/leads'

// One lead's conversation: the messages, and the context a person needs
// beside them to answer well.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name, phone, email, source, stage, estimated_value_cents, ai_state, patient_id, ai_taken_over_at, clinics:clinic_id(name), team_members:ai_taken_over_by(full_name)')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  const { data: messages } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, body_preview, channel, status, created_at, template_name')
    .eq('lead_id', id)
    .order('created_at', { ascending: true })
    .limit(200)

  // The 24h customer-service window decides whether a free-text reply is even
  // possible, so the composer needs to know before it lets someone type a
  // message WhatsApp will refuse.
  const lastInbound = [...(messages ?? [])].reverse().find((m) => m.direction === 'inbound')
  const withinWindow = lastInbound ? Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 3600 * 1000 : false

  // Only what is actually known about this person. A lead has no visit
  // history and no balance -- that is what being a lead means -- so those
  // rows are absent rather than rendered as zeroes that look like facts.
  const patient = lead.patient_id
    ? await supabase.from('patients').select('id, balance_cents').eq('id', lead.patient_id).maybeSingle()
    : null

  return {
    id: lead.id,
    name: lead.full_name,
    phone: lead.phone,
    email: lead.email,
    source: lead.source,
    stage: lead.stage,
    value: formatEuros(lead.estimated_value_cents),
    aiState: lead.ai_state,
    takenOverBy: lead.team_members?.full_name ?? null,
    takenOverAt: lead.ai_taken_over_at,
    clinic: lead.clinics?.name ?? null,
    patientId: lead.patient_id,
    patientBalance: patient?.data ? formatEuros(patient.data.balance_cents) : null,
    canReplyFreeText: withinWindow,
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      // A lead's own messages are inbound; everything outbound came from the
      // clinic. Which human or model sent it is not recorded on the row, so
      // it is not claimed here either.
      from: message.direction === 'inbound' ? ('lead' as const) : ('clinic' as const),
      text: message.body_preview ?? '',
      channel: message.channel,
      status: message.status,
      at: message.created_at,
      templateName: message.template_name,
    })),
  }
})
