import { requireGrowth } from '~/server/utils/requireGrowth'

const STATES = ['none', 'handling', 'paused', 'needs_human', 'blocked'] as const
type AiState = (typeof STATES)[number]

interface Body {
  state?: unknown
}

/**
 * Hands a conversation between the AI and a person.
 *
 * The one rule worth enforcing server-side rather than trusting the button:
 * taking over records WHO took over. Two people looking at the same
 * escalated thread is the failure this whole control exists to prevent, and
 * the second one needs to see that the first already has it -- which is only
 * possible if the name is stored rather than implied by a boolean.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requireGrowth(event)
  const body = (await readBody<Body>(event).catch(() => null)) ?? ({} as Body)

  if (!STATES.includes(body.state as AiState)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown AI state' })
  }
  const state = body.state as AiState

  const { data: lead, error } = await supabase
    .from('leads')
    .update({
      ai_state: state,
      // Cleared when the AI takes it back, so a later takeover does not
      // report whoever happened to touch it last week.
      ai_taken_over_by: state === 'paused' ? teamMember.id : null,
      ai_taken_over_at: state === 'paused' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .select('id, ai_state, team_members:ai_taken_over_by(full_name)')
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  // Recorded on the lead's own timeline, not just in the inbox: "who silenced
  // the AI on this conversation, and when" is a question asked afterwards.
  await supabase.from('lead_events').insert({
    account_id: teamMember.account_id,
    lead_id: id,
    kind: 'note',
    title: state === 'paused' ? 'A person took over from the AI' : state === 'handling' ? 'Handed back to the AI' : `AI state set to ${state}`,
  })

  return { id: lead.id, aiState: lead.ai_state, takenOverBy: lead.team_members?.full_name ?? null }
})
