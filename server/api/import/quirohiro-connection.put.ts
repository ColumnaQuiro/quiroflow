import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import { quirohiroCheckConnection, quirohiroLocationId, QuirohiroError } from '~/server/utils/quirohiro'

// Saves the QuiroHiro connection: the clinic's QuiroHiro address (or its
// location id) and a Private Integration token. The token is write-only, in
// account_secrets; leaving it empty keeps the one already stored.
//
// Both are tried against QuiroHiro before anything is saved, once for each
// thing the import reads, so a token missing a scope is named here rather than
// ten minutes into an import.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const body = await readBody<{ location?: string; token?: string }>(event)
  const locationId = quirohiroLocationId(body?.location ?? '')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Paste the address of any QuiroHiro page while signed in: it looks like https://app.quirohiro.io/v2/location/… and the part after /location/ is what identifies your clinic.' })
  }
  const admin = serverSupabaseServiceRole<Database>(event)
  const typed = (body?.token ?? '').trim()
  if (typed && !/^pit-[0-9a-f-]{20,}$/i.test(typed)) {
    throw createError({ statusCode: 400, statusMessage: 'That is not a Private Integration token: QuiroHiro shows one starting with "pit-" when you create the integration, under Settings > Private Integrations.' })
  }
  const token = typed || (await getAccountSecret(admin, accountId, 'quirohiro_token'))
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Paste the Private Integration token as well.' })

  let name: string
  try {
    ({ name } = await quirohiroCheckConnection({ token, locationId }))
  } catch (e) {
    if (e instanceof QuirohiroError) throw createError({ statusCode: e.statusCode >= 500 ? 502 : 400, statusMessage: e.message })
    throw e
  }
  await setAccountSecret(admin, accountId, 'quirohiro_location_id', locationId)
  await setAccountSecret(admin, accountId, 'quirohiro_location_name', name)
  if (typed) await setAccountSecret(admin, accountId, 'quirohiro_token', typed)
  return { locationId, locationName: name }
})
