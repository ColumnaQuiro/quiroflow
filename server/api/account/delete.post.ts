import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Backs "delete my account" (Apple App Store Guideline 5.1.1(v)) for
// whichever kind of account the signed-in user actually has. Works for the
// web app (cookie) and mobile (bearer token) alike since requireAuthedUser
// already handles both transports.
//
// Patients: a real, hard delete. patients.user_id has ON DELETE SET NULL,
// so removing the auth user just unlinks portal access -- the clinical
// record (and its legal retention) is untouched.
//
// Staff: NOT a hard delete. team_members.user_id cascades on delete
// straight through cash_shifts.opened_by and cash_movements.team_member_id
// (both not-null, on delete cascade) -- deleting a staff member who ever
// opened a cash shift would silently destroy real financial audit records.
// Deactivation instead: login is revoked immediately (auth admin ban), and
// deleted_at hides them from active-staff lists and (via the RBAC helper
// functions patched alongside this) blocks permission-gated access even
// before their existing token naturally expires.
export default defineEventHandler(async (event) => {
  const { supabase, user } = await requireAuthedUser(event)
  const serviceRole = serverSupabaseServiceRole<Database>(event)

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, account_id, is_owner')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (teamMember) {
    if (teamMember.is_owner) {
      const { count } = await supabase
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', teamMember.account_id)
        .eq('is_owner', true)
        .is('deleted_at', null)
      if ((count ?? 0) <= 1) {
        throw createError({
          statusCode: 400,
          statusMessage: "You're the only owner on this account. Make another team member an owner first, or contact support to close the whole clinic account, before deleting your own login.",
        })
      }
    }

    await serviceRole.from('team_members').update({ deleted_at: new Date().toISOString() }).eq('id', teamMember.id)
    // Supabase has no literal "forever" ban -- a 10-year duration is the
    // standard stand-in every implementation of this uses.
    await serviceRole.auth.admin.updateUserById(user.id, { ban_duration: '87600h' })
    return { result: 'deactivated' }
  }

  const { data: patient } = await supabase.from('patients').select('id').eq('user_id', user.id).maybeSingle()
  if (patient) {
    await serviceRole.auth.admin.deleteUser(user.id)
    return { result: 'deleted' }
  }

  throw createError({ statusCode: 404, statusMessage: 'No account found to delete.' })
})
