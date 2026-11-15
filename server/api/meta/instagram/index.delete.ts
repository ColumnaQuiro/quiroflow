import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { deleteAccountSecret, getAccountSecret } from '~/server/utils/accountSecrets'

// Disconnects Instagram, and Messenger with it: they are one Page connection.
//
// The ids are what route a DM to this clinic, so clearing them is what
// actually stops DMs arriving here; the Page token goes with them. The
// conversations already in the Inbox stay -- they happened.
//
// The Page is also unsubscribed from this app, best effort. Without that Meta
// keeps posting every DM to the webhook, which drops them for want of a
// clinic -- harmless, but a Page nobody uses any more keeps calling us.
// Failing to unsubscribe does not stop the disconnect: a token Meta no longer
// accepts is a common reason to disconnect in the first place.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const admin = serverSupabaseServiceRole<Database>(event)

  const [{ data: account }, token] = await Promise.all([
    admin.from('accounts').select('messenger_page_id').eq('id', teamMember.account_id).maybeSingle(),
    getAccountSecret(admin, teamMember.account_id, 'instagram_access_token'),
  ])
  if (account?.messenger_page_id && token) {
    try {
      await $fetch(`${useRuntimeConfig().metaGraphBaseUrl}/${account.messenger_page_id}/subscribed_apps`, {
        method: 'DELETE',
        query: { access_token: token },
      })
    } catch (err: any) {
      console.warn(`[meta/instagram] could not unsubscribe Page ${account.messenger_page_id}:`, err?.data?.error?.message ?? err?.message)
    }
  }

  // Service role: instagram_user_id and messenger_page_id are written only by
  // the server (accounts_guard_server_written).
  const { error } = await admin.from('accounts').update({ instagram_user_id: null, messenger_page_id: null }).eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  await deleteAccountSecret(admin, teamMember.account_id, 'instagram_access_token')
  return { ok: true }
})
