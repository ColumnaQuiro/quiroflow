import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loose } from '~/server/utils/publicApiHandlers'
import { syncLeadAdPage, type SyncablePage } from '~/server/utils/metaLeadAds'

// "Fetch missed leads" in Settings: the hourly sweep, now, for one Page.
// Mostly for the moment right after connecting, and for checking a fix --
// waiting up to an hour to see whether a reconnect worked is not a test.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const pageId = getRouterParam(event, 'pageId') ?? ''

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: page } = await loose(admin)
    .from('lead_ad_pages')
    .select('account_id, page_id, form_submission_is_consent, connected_at, last_synced_at')
    .eq('page_id', pageId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!page) throw createError({ statusCode: 404, statusMessage: 'That Page is not connected to this account.' })

  const result = await syncLeadAdPage(admin, page as SyncablePage, getRequestURL(event).origin)
  if (result.error) throw createError({ statusCode: 502, statusMessage: result.error })
  return result
})
