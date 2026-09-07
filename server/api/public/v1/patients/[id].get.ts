import { ApiError, defineApiHandler, notFound } from '~/server/utils/publicApi'
import { loose } from '~/server/utils/publicApiHandlers'
import { assertUuid } from '~/server/utils/publicApiQuery'
import { patientsResource } from '~/server/utils/publicApiResources'

// Detail rather than the generic handler because a patient is far more
// useful with their phone numbers attached: the list endpoint deliberately
// leaves them off (one extra query per row), but almost every integration
// that fetches a single patient wants to contact them.
export default defineApiHandler({ scope: 'patients:read' }, async ({ event, supabase, accountId }) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id')

  const { data: patient, error } = await loose(supabase)
    .from('patients')
    .select(patientsResource.select)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new ApiError('server_error', error.message)
  if (!patient) throw notFound('patient')

  const { data: numbers } = await loose(supabase)
    .from('patient_contact_numbers')
    .select('id, number, country_code, is_whatsapp')
    .eq('account_id', accountId)
    .eq('patient_id', id)
    .order('created_at', { ascending: true })

  return {
    data: {
      ...patientsResource.serialize(patient),
      contact_numbers: (numbers ?? []).map((n) => ({
        id: n.id,
        number: n.number,
        country_code: n.country_code,
        is_whatsapp: n.is_whatsapp,
      })),
    },
  }
})
