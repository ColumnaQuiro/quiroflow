import { requireGrowth } from '~/server/utils/requireGrowth'
import { STAGE_TITLES, isLeadStage, type LeadStage } from '~/server/utils/leads'
import type { TablesUpdate } from '~/types/database.types'

interface Body {
  stage?: unknown
  ownerTeamMemberId?: unknown
  estimatedValueCents?: unknown
  aiHandling?: unknown
}

// Updates a lead. The board's drag is the main caller, sending only `stage`.
//
// stage_changed_at is deliberately NOT set here -- the trigger on `leads`
// owns it, so a stage moved by an automation or by the AI receptionist
// booking an appointment gets the same treatment as one dragged by hand.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requireGrowth(event)
  const body = await readBody<Body>(event)

  // The generated Update type rather than a loose record, so a column typo
  // here is a compile error instead of a silently ignored key.
  const patch: TablesUpdate<'leads'> = {}

  if (body.stage !== undefined) {
    if (!isLeadStage(body.stage)) throw createError({ statusCode: 400, statusMessage: 'Unknown stage' })
    patch.stage = body.stage
  }
  if (body.ownerTeamMemberId !== undefined) {
    patch.owner_team_member_id = typeof body.ownerTeamMemberId === 'string' ? body.ownerTeamMemberId : null
  }
  if (body.estimatedValueCents !== undefined) {
    const value = body.estimatedValueCents
    if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
      throw createError({ statusCode: 400, statusMessage: 'Estimated value must be a whole number of cents' })
    }
    patch.estimated_value_cents = value
  }
  if (body.aiHandling !== undefined) {
    if (typeof body.aiHandling !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'aiHandling must be a boolean' })
    patch.ai_handling = body.aiHandling
  }

  if (Object.keys(patch).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  }

  // Read the current stage first so the timeline entry can name both ends of
  // the move, and so a no-op drag (dropped back where it started) does not
  // write a misleading "moved from Booked to Booked".
  const { data: before } = await supabase
    .from('leads')
    .select('stage')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!before) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  const { data: lead, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .select('id, stage, stage_changed_at')
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  // A stage change is the one edit worth a timeline entry: it is what the
  // funnel is measured on, and "who moved this to Lost, and when" is the
  // question someone asks a week later.
  if (typeof patch.stage === 'string' && patch.stage !== before.stage) {
    await supabase.from('lead_events').insert({
      account_id: teamMember.account_id,
      lead_id: id,
      kind: 'stage_change',
      title: `Moved to ${STAGE_TITLES[patch.stage as LeadStage]}`,
      detail: `From ${STAGE_TITLES[before.stage as LeadStage] ?? before.stage}`,
    })
  }

  return { id: lead.id, stage: lead.stage, stageChangedAt: lead.stage_changed_at }
})
