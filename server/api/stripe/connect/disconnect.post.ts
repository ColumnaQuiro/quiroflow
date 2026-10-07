import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Disconnecting Stripe on Settings > Payments. It only cleared our record of
// the connected account: QuiroFlow stayed authorised on it in Stripe, listed
// under the clinic's connected apps and able to charge through it. Now the
// authorisation is revoked in Stripe first, then the record cleared.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'billing_config')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await admin.from('accounts').select('stripe_connect_account_id').eq('id', teamMember.account_id).maybeSingle()
  const connected = account?.stripe_connect_account_id

  if (connected) {
    const clientId = useRuntimeConfig().public.stripeConnectClientId
    if (clientId) {
      try {
        await stripeForPlatform().oauth.deauthorize({ client_id: clientId, stripe_user_id: connected })
      } catch (err: any) {
        // Already revoked from the clinic's own Stripe dashboard: nothing left
        // to undo there, so the record is cleared all the same.
        const alreadyGone = err?.code === 'invalid_client' || /not connected|no such account|not authorized/i.test(err?.message ?? '')
        if (!alreadyGone) throw createError({ statusCode: 502, statusMessage: `Stripe did not confirm the disconnection: ${err?.message ?? 'unknown error'}` })
      }
    }
  }

  const { error } = await admin.from('accounts').update({ stripe_connect_account_id: null, stripe_publishable_key: null }).eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true }
})
