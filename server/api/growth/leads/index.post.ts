import { requirePermission } from '~/server/utils/requirePermission'
import { isLeadChannel, isLeadStage, nextLeadReference } from '~/server/utils/leads'

interface Body {
  fullName?: unknown
  phone?: unknown
  email?: unknown
  channel?: unknown
  source?: unknown
  stage?: unknown
  estimatedValueCents?: unknown
  clinicId?: unknown
}

// Creates a lead. Used by "Add lead" on the board today; the AI receptionist
// and the ad-platform webhooks land here too once they exist, which is why
// the reference and the opening timeline entry are written here rather than
// by the caller.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const body = await readBody<Body>(event)

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (!fullName) throw createError({ statusCode: 400, statusMessage: 'A name is required' })

  if (!isLeadChannel(body.channel)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown channel' })
  }
  // Stage is accepted on create because a walk-in who books at the desk is
  // never in 'new' -- but it still has to be a real stage.
  if (body.stage !== undefined && !isLeadStage(body.stage)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown stage' })
  }

  const value = body.estimatedValueCents
  if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Estimated value must be a whole number of cents' })
  }

  const reference = await nextLeadReference(supabase, teamMember.account_id)

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      account_id: teamMember.account_id,
      clinic_id: typeof body.clinicId === 'string' ? body.clinicId : null,
      reference,
      full_name: fullName,
      phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
      email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
      channel: body.channel,
      source: typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null,
      stage: isLeadStage(body.stage) ? body.stage : 'new',
      estimated_value_cents: typeof value === 'number' ? value : null,
      owner_team_member_id: teamMember.id,
    })
    .select('id, reference')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  // The timeline should never start empty: a drawer opened on a brand-new
  // lead ought to say where it came from, not show a blank feed.
  await supabase.from('lead_events').insert({
    account_id: teamMember.account_id,
    lead_id: lead.id,
    kind: 'note',
    title: 'Lead created',
    detail: typeof body.source === 'string' && body.source.trim() ? `Source: ${body.source.trim()}` : 'Added by hand',
  })

  setResponseStatus(event, 201)
  return { id: lead.id, reference: lead.reference }
})
