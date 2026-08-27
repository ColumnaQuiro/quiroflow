import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Staff have no UI to see or change another team member's password --
// this triggers Supabase's own "reset your password" email to their
// account, the same flow they'd get from the login page's "Forgot
// password" link, just staff-initiated for someone who's locked out.
export default defineEventHandler(async (event) => {
  const targetId = getRouterParam(event, 'id')
  if (!targetId) throw createError({ statusCode: 400, statusMessage: 'Missing team member id' })

  const { supabase, teamMember } = await requirePermission(event, 'team_admin')

  const { data: target } = await supabase.from('team_members').select('id, account_id, user_id').eq('id', targetId).maybeSingle()
  if (!target || target.account_id !== teamMember.account_id) {
    throw createError({ statusCode: 404, statusMessage: 'Team member not found' })
  }

  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const { data: userData, error: userError } = await serviceRole.auth.admin.getUserById(target.user_id)
  if (userError || !userData?.user?.email) {
    throw createError({ statusCode: 404, statusMessage: 'No email on file for this team member' })
  }

  const origin = getRequestURL(event).origin
  const { error: resetError } = await serviceRole.auth.resetPasswordForEmail(userData.user.email, { redirectTo: `${origin}/reset-password` })
  if (resetError) throw createError({ statusCode: 500, statusMessage: resetError.message })

  return { sent: true, email: userData.user.email }
})
