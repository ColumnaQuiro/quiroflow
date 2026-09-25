import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Each team member's login email and last sign-in, for Settings -> Team.
// Both live in auth.users, which only the service role can read, so the page
// asks here rather than reading them itself. Scoped to the caller's own
// account and to team_admin, the same gate as the page.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'team_admin')
  const { data: members } = await supabase.from('team_members').select('id, user_id').eq('account_id', teamMember.account_id)
  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const out: { id: string; email: string | null; lastSignInAt: string | null }[] = []
  for (const m of members ?? []) {
    if (!m.user_id) {
      out.push({ id: m.id, email: null, lastSignInAt: null })
      continue
    }
    const { data } = await serviceRole.auth.admin.getUserById(m.user_id)
    out.push({ id: m.id, email: data.user?.email ?? null, lastSignInAt: data.user?.last_sign_in_at ?? null })
  }
  return { members: out }
})
