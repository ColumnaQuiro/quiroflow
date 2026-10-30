import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Settings > Clínicas > one location > Portal de llegada: this location's
// tablet link, or null while it is off. The link is read on the service role
// -- check_in_portals has no policies -- after the guard has checked the
// caller may configure this account's clinics.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'clinic_config')
  const clinicId = getRouterParam(event, 'id')!
  const { data: clinic } = await supabase.from('clinics').select('id').eq('id', clinicId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!clinic) throw createError({ statusCode: 404, statusMessage: 'Clinic not found' })

  const { data } = await serverSupabaseServiceRole<Database>(event).from('check_in_portals').select('token').eq('clinic_id', clinic.id).maybeSingle()
  return { token: data?.token ?? null }
})
