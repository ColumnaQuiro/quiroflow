import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Makes someone an owner, or stops them being one. Being an owner is total
// access whatever the role (has_permission and can() both short-circuit on
// is_owner), so only an owner may hand it out or take it away -- a team_admin
// who is not one must not be able to promote themselves or anyone else. And
// an account never ends up with no owner: the last one cannot be removed.
export default defineEventHandler(async (event) => {
  const targetId = getRouterParam(event, 'id')
  if (!targetId) throw createError({ statusCode: 400, statusMessage: 'Missing team member id' })
  const body = await readBody<{ isOwner: boolean }>(event)
  if (typeof body?.isOwner !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'isOwner is required' })

  const { supabase, teamMember } = await requireSettingsPermission(event, 'team_admin')
  if (!teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can change who is an owner.' })

  const { data: target } = await supabase
    .from('team_members')
    .select('id, account_id, is_owner')
    .eq('id', targetId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!target || target.account_id !== teamMember.account_id) throw createError({ statusCode: 404, statusMessage: 'Team member not found' })
  if (target.is_owner === body.isOwner) return { isOwner: body.isOwner }

  if (!body.isOwner) {
    const { count } = await supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('account_id', target.account_id).eq('is_owner', true).is('deleted_at', null)
    if ((count ?? 0) <= 1) throw createError({ statusCode: 400, statusMessage: 'This is the only owner. Make someone else an owner first.' })
  }

  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const { error } = await serviceRole.from('team_members').update({ is_owner: body.isOwner }).eq('id', target.id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { isOwner: body.isOwner }
})
