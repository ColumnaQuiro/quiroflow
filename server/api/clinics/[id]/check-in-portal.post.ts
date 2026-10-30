import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { PORTAL_SETTINGS_SELECT as SELECT, checkInPortalSettings, newCheckInPortalToken } from '~/server/utils/checkInPortal'

// Turns this location's check-in portal on, or with { renew: true } gives it
// a new link -- for a tablet that went missing: the old link stops working at
// once. How it identifies patients, its language and its messages are kept
// across a renewal. Answers the
// portal as Settings shows it.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'clinic_config')
  const clinicId = getRouterParam(event, 'id')!
  const body = await readBody<{ renew?: boolean } | null>(event)
  const { data: clinic } = await supabase.from('clinics').select('id, archived_at').eq('id', clinicId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!clinic) throw createError({ statusCode: 404, statusMessage: 'Clinic not found' })
  if (clinic.archived_at) throw createError({ statusCode: 409, statusMessage: 'This location is archived' })

  // The guard swapped in a service client that names the caller to the
  // audit trail, so the change is recorded as theirs.
  const service = serverSupabaseServiceRole<Database>(event)
  const { data: existing } = await service.from('check_in_portals').select(SELECT).eq('clinic_id', clinic.id).maybeSingle()
  if (existing && !body?.renew) return checkInPortalSettings(existing)

  const token = newCheckInPortalToken()
  const { data, error } = existing
    ? await service.from('check_in_portals').update({ token, created_at: new Date().toISOString() }).eq('clinic_id', clinic.id).select(SELECT).single()
    : await service.from('check_in_portals').insert({ clinic_id: clinic.id, account_id: teamMember.account_id, token }).select(SELECT).single()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return checkInPortalSettings(data)
})
