import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Brings a deactivated team member back: login restored, back in the active
// lists. A practitioner coming back takes a seat again, so the seat trigger
// (enforce_practitioner_seats) can refuse this with a 402 and its own message,
// which is passed through as is. Online booking stays off until someone turns
// it back on from their page -- they may not be taking bookings yet.
export default defineEventHandler(async (event) => {
  const targetId = getRouterParam(event, 'id')
  if (!targetId) throw createError({ statusCode: 400, statusMessage: 'Missing team member id' })
  const { supabase, teamMember } = await requireSettingsPermission(event, 'team_admin')
  const { data: target } = await supabase
    .from('team_members')
    .select('id, account_id, user_id, is_owner, deleted_at')
    .eq('id', targetId)
    .not('deleted_at', 'is', null)
    .maybeSingle()
  if (!target || target.account_id !== teamMember.account_id) throw createError({ statusCode: 404, statusMessage: 'Team member not found' })
  if (target.is_owner && !teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can reactivate an owner.' })

  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const { error } = await serviceRole.from('team_members').update({ deleted_at: null }).eq('id', target.id)
  if (error) {
    throw createError({ statusCode: error.code === 'PT402' ? 402 : 500, statusMessage: error.message })
  }
  if (target.user_id) await serviceRole.auth.admin.updateUserById(target.user_id, { ban_duration: 'none' })
  return { reactivated: true }
})
