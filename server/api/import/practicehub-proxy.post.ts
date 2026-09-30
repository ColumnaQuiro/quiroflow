import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'

// PracticeHub's API sends no CORS headers, so the browser can't call it
// directly -- this just forwards one paginated request server-side. Auth
// still requires a signed-in team member so this can't be used as an open
// proxy to arbitrary URLs by anyone who finds the endpoint.
//
// With no apiKey in the body it uses the connection saved in Settings >
// Import: the key from account_secrets and the SAVED address -- never one
// from the body, or the stored key could be sent to any host by whoever
// calls this.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')

  const body = await readBody<{
    baseUrl: string
    apiKey?: string
    appDetails: string
    path: string
    page?: number
    pageSize?: number
  }>(event)
  if (!body?.appDetails || !body?.path) {
    throw createError({ statusCode: 400, statusMessage: 'appDetails and path are required' })
  }
  let baseUrl = body.baseUrl
  let apiKey = body.apiKey
  if (!apiKey) {
    const admin = serverSupabaseServiceRole<Database>(event)
    const { data: saved } = await admin.from('accounts').select('practicehub_base_url').eq('id', teamMember.account_id).maybeSingle()
    baseUrl = saved?.practicehub_base_url ?? ''
    apiKey = (await getAccountSecret(admin, teamMember.account_id, 'practicehub_api_key')) ?? ''
    if (!baseUrl || !apiKey) {
      throw createError({ statusCode: 400, statusMessage: 'No PracticeHub connection is saved. Set it up in Settings > Import > Connection.' })
    }
  }
  if (!baseUrl) throw createError({ statusCode: 400, statusMessage: 'baseUrl is required' })

  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api${body.path}`)
  if (body.page) url.searchParams.set('page', String(body.page))
  url.searchParams.set('page_size', String(body.pageSize ?? 100))

  try {
    const data = await $fetch(url.toString(), {
      headers: { 'x-practicehub-key': apiKey, 'x-app-details': body.appDetails },
    })
    return data
  } catch (err: any) {
    throw createError({ statusCode: err?.response?.status ?? 502, statusMessage: err?.data?.message ?? 'PracticeHub API request failed' })
  }
})
