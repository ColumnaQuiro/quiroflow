import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Turns this location's check-in portal off. The link goes with the row, so
// a tablet still showing it says "switched off" on its next patient.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'clinic_config')
  const clinicId = getRouterParam(event, 'id')!
  const { data: clinic } = await supabase.from('clinics').select('id').eq('id', clinicId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!clinic) throw createError({ statusCode: 404, statusMessage: 'Clinic not found' })

  const { error } = await serverSupabaseServiceRole<Database>(event).from('check_in_portals').delete().eq('clinic_id', clinic.id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { token: null }
})
