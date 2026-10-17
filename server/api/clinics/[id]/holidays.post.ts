import { closePublicHolidays, reopenPublicHolidays } from '~/server/utils/publicHolidays'
import { HOLIDAY_REGIONS } from '~/utils/spanishHolidays'

// Settings > Sedes > Cierres y festivos: close the clinic on its comunidad's
// official holidays, now and in the years still to be published
// (server/utils/publicHolidays.ts). Body { region, auto }.
//   auto: true    sets the region and closes every known holiday from today;
//                 a different region than before first reopens the old one's
//   auto: false   reopens the official holidays still to come
// Answers the holidays it closed, each with the visits already booked that day.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireSettingsPermission(event, 'clinic_config')
  const clinicId = getRouterParam(event, 'id')
  const body = await readBody<{ region?: string | null; auto?: boolean }>(event)
  const region = body?.region ?? null
  if (region !== null && !HOLIDAY_REGIONS[region]) throw createError({ statusCode: 400, statusMessage: 'Unknown region' })
  if (body?.auto && !region) throw createError({ statusCode: 400, statusMessage: 'Choose the comunidad first' })

  const { data: clinic } = await supabase
    .from('clinics')
    .select('id, account_id, timezone, holiday_region, holidays_auto, holidays_loaded_through')
    .eq('id', clinicId!)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!clinic) throw createError({ statusCode: 404, statusMessage: 'Clinic not found' })

  const fail = (e: unknown) => {
    throw createError({ statusCode: 500, statusMessage: e instanceof Error ? e.message : 'Could not update the holidays' })
  }
  const regionChanged = clinic.holiday_region !== region
  if (!body?.auto || regionChanged) await reopenPublicHolidays(supabase, clinic).catch(fail)

  const { error } = await supabase
    .from('clinics')
    .update({ holiday_region: region, holidays_auto: !!body?.auto, ...(regionChanged || !body?.auto ? { holidays_loaded_through: null } : {}) })
    .eq('id', clinic.id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!body?.auto) return { closed: [] }

  const closed = await closePublicHolidays(supabase, {
    ...clinic,
    holiday_region: region,
    holidays_loaded_through: regionChanged ? null : clinic.holidays_loaded_through,
  }).catch(fail)
  return { closed }
})
