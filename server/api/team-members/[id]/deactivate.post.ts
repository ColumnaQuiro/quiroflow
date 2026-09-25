import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Deactivates someone who has left the clinic -- the admin's side of what
// /api/account/delete does for your own login. Nothing is deleted:
// team_members.user_id cascades into cash shifts and cash movements, so a hard
// delete would destroy financial records. Instead login is revoked (auth ban),
// deleted_at takes them out of every active list and permission check, and
// online booking is switched off so nobody books them while they are gone.
//
// Their upcoming appointments can be handed to someone else in the same
// step; otherwise they stay on the calendar under a name nobody can open.
export default defineEventHandler(async (event) => {
  const targetId = getRouterParam(event, 'id')
  if (!targetId) throw createError({ statusCode: 400, statusMessage: 'Missing team member id' })
  const body = await readBody<{ reassignTo?: string | null }>(event).catch(() => ({ reassignTo: null }))

  const { supabase, teamMember } = await requireSettingsPermission(event, 'team_admin')
  const { data: target } = await supabase
    .from('team_members')
    .select('id, account_id, user_id, is_owner')
    .eq('id', targetId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!target || target.account_id !== teamMember.account_id) throw createError({ statusCode: 404, statusMessage: 'Team member not found' })

  if (target.id === teamMember.id) {
    throw createError({ statusCode: 400, statusMessage: 'Close your own login from Account Settings instead.' })
  }
  if (target.is_owner) {
    if (!teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can deactivate an owner.' })
    const { count } = await supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('account_id', target.account_id).eq('is_owner', true).is('deleted_at', null)
    if ((count ?? 0) <= 1) throw createError({ statusCode: 400, statusMessage: 'This is the only owner. Make someone else an owner first.' })
  }

  const serviceRole = serverSupabaseServiceRole<Database>(event)

  if (body?.reassignTo) {
    const { data: heir } = await serviceRole
      .from('team_members')
      .select('id, account_id, is_practitioner')
      .eq('id', body.reassignTo)
      .is('deleted_at', null)
      .maybeSingle()
    if (!heir || heir.account_id !== target.account_id || heir.id === target.id) {
      throw createError({ statusCode: 400, statusMessage: 'Pick an active team member to take the appointments.' })
    }
    const { error } = await serviceRole
      .from('appointments')
      .update({ practitioner_id: heir.id })
      .eq('practitioner_id', target.id)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .gte('starts_at', new Date().toISOString())
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const { error } = await serviceRole
    .from('team_members')
    .update({ deleted_at: new Date().toISOString(), online_booking_enabled: false })
    .eq('id', target.id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (target.user_id) {
    // Supabase has no literal "forever" ban -- 10 years is the usual stand-in.
    await serviceRole.auth.admin.updateUserById(target.user_id, { ban_duration: '87600h' })
  }
  return { deactivated: true }
})
