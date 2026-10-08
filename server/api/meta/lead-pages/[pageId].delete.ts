import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loose } from '~/server/utils/publicApiHandlers'

// Disconnects a Page: stops its leads arriving here and forgets its token.
//
// Unsubscribing on Meta's side is best effort. The token may already be dead
// -- that is often WHY someone is disconnecting -- and a Page we no longer
// know is dropped by the webhook anyway. What must happen is the local
// delete, so it happens regardless.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const pageId = getRouterParam(event, 'pageId') ?? ''

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: page } = await loose(admin)
    .from('lead_ad_pages')
    .select('page_id')
    .eq('page_id', pageId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!page) throw createError({ statusCode: 404, statusMessage: 'That Page is not connected to this account.' })

  const { data: tokenRow } = await loose(admin).from('lead_ad_page_tokens').select('access_token').eq('page_id', pageId).maybeSingle()
  const token = (tokenRow as { access_token?: string } | null)?.access_token
  if (token) {
    try {
      await $fetch(`${useRuntimeConfig().metaGraphBaseUrl}/${pageId}/subscribed_apps`, { method: 'DELETE', query: { access_token: token } })
    } catch (err: any) {
      console.warn(`[meta-leadgen] could not unsubscribe Page ${pageId} on disconnect: ${err?.data?.error?.message ?? err?.message}`)
    }
  }

  // The token goes with the row (on delete cascade).
  const { error } = await loose(admin).from('lead_ad_pages').delete().eq('page_id', pageId).eq('account_id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { disconnected: true }
})
