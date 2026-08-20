import { serverSupabaseClient } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

export async function requireTeamMember(event: H3Event) {
  const supabase = await serverSupabaseClient<Database>(event)
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, account_id, is_owner, role_id')
    .maybeSingle()

  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  return { supabase, teamMember }
}

export async function requirePermission(event: H3Event, permKey: string) {
  const { supabase, teamMember } = await requireTeamMember(event)

  if (!teamMember.is_owner) {
    const { data: allowed } = await supabase.rpc('has_permission', {
      target_account_id: teamMember.account_id,
      perm_key: permKey,
    })
    if (!allowed) {
      throw createError({ statusCode: 403, statusMessage: `Missing permission: ${permKey}` })
    }
  }

  return { supabase, teamMember }
}
