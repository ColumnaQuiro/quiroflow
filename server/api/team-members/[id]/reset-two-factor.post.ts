import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Removes a team member's authenticator so they can set up a new one -- the
// recovery path for a lost or replaced phone. Supabase issues no backup
// codes, so without this a clinic that requires two-factor would have no way
// back in for that person short of support editing auth tables by hand.
//
// Needs the service role: GoTrue only lets a user remove their OWN verified
// factor, and only from a session that has already passed it.
export default defineEventHandler(async (event) => {
  const targetId = getRouterParam(event, 'id')
  if (!targetId) throw createError({ statusCode: 400, statusMessage: 'Missing team member id' })

  const { supabase, teamMember } = await requireSettingsPermission(event, 'team_admin')

  const { data: target } = await supabase
    .from('team_members')
    .select('id, account_id, user_id, is_owner')
    .eq('id', targetId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!target || target.account_id !== teamMember.account_id) {
    throw createError({ statusCode: 404, statusMessage: 'Team member not found' })
  }

  // Your own is removed from Account Settings, from a session that has
  // passed it -- not from here, where it would only need the password.
  if (target.id === teamMember.id) {
    throw createError({ statusCode: 400, statusMessage: 'Turn off your own two-factor from Account Settings' })
  }

  // An admin who is not an owner could otherwise strip the owner's second
  // factor, and then the owner's password alone would open the account.
  if (target.is_owner && !teamMember.is_owner) {
    throw createError({ statusCode: 403, statusMessage: "Only an owner can reset an owner's two-factor" })
  }

  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const { data: factors, error: listError } = await serviceRole.auth.admin.mfa.listFactors({ userId: target.user_id })
  if (listError) throw createError({ statusCode: 500, statusMessage: listError.message })

  let removed = 0
  for (const factor of factors?.factors ?? []) {
    const { error } = await serviceRole.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.user_id })
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    removed++
  }

  return { removed }
})
