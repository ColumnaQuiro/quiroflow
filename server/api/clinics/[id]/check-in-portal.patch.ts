import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { checkInPortalSettings, portalMessage } from '~/server/utils/checkInPortal'
import { isPortalLanguage } from '~/utils/checkInPortalText'

// The portal's language and its three messages (welcome, arrived, not
// found), from Settings. A blank message is the standard wording. Only for a
// portal that is on: turning it on is POST.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'clinic_config')
  const clinicId = getRouterParam(event, 'id')!
  const body = await readBody<{ language?: string; welcomeMessage?: string; successMessage?: string; notFoundMessage?: string }>(event)
  if (!isPortalLanguage(body?.language)) throw createError({ statusCode: 400, statusMessage: 'Unknown language' })
  const { data: clinic } = await supabase.from('clinics').select('id').eq('id', clinicId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!clinic) throw createError({ statusCode: 404, statusMessage: 'Clinic not found' })

  const { data, error } = await serverSupabaseServiceRole<Database>(event)
    .from('check_in_portals')
    .update({
      language: body.language,
      welcome_message: portalMessage(body.welcomeMessage),
      success_message: portalMessage(body.successMessage),
      not_found_message: portalMessage(body.notFoundMessage),
    })
    .eq('clinic_id', clinic.id)
    .select('token, language, welcome_message, success_message, not_found_message')
    .maybeSingle()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!data) throw createError({ statusCode: 409, statusMessage: 'The check-in portal is off' })
  return checkInPortalSettings(data)
})
