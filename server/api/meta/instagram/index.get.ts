import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'
import { metaErrorMessage } from '~/server/utils/metaLeadAds'

// The Instagram and Messenger connection as Settings > Instagram & Messenger
// shows it. The @handle and the Page's name come from Meta, live, with the
// stored Page token: a clinic recognises "@clinica", not 17841400000000000,
// and a token Meta has stopped accepting shows up here first rather than as
// a reply that will not send.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const admin = serverSupabaseServiceRole<Database>(event)

  const [{ data: account }, token] = await Promise.all([
    admin.from('accounts').select('instagram_user_id, messenger_page_id').eq('id', teamMember.account_id).maybeSingle(),
    getAccountSecret(admin, teamMember.account_id, 'instagram_access_token'),
  ])
  const instagramUserId = account?.instagram_user_id ?? null
  const messengerPageId = account?.messenger_page_id ?? null
  const base = { instagramUserId, messengerPageId, hasToken: Boolean(token), username: null as string | null, pageName: null as string | null, error: null as string | null }
  if (!instagramUserId || !token) return base

  const GRAPH = useRuntimeConfig().metaGraphBaseUrl
  try {
    const [ig, page] = await Promise.all([
      $fetch<{ username?: string }>(`${GRAPH}/${instagramUserId}`, { query: { fields: 'username', access_token: token } }),
      messengerPageId ? $fetch<{ name?: string }>(`${GRAPH}/${messengerPageId}`, { query: { fields: 'name', access_token: token } }) : null,
    ])
    return { ...base, username: ig.username ?? null, pageName: page?.name ?? null }
  } catch (err) {
    return { ...base, error: metaErrorMessage(err) }
  }
})
