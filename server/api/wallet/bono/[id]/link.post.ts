import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loadBonoPass, walletEnabled, walletLinkToken } from '~/server/utils/walletPass'
import { googleBonoSaveUrl, googleWalletConfig, sendGoogleBono } from '~/server/utils/googleWallet'

// "Añadir a … Wallet" on a bono (the patient's app or portal). Who may have
// it is the read below, as the caller: the "patients view own
// package_purchases" policy, or a staff member's own.
//
// Apple (the default): a link to the .pkpass, signed for ten minutes, because
// it is opened in Safari -- which adds it to Wallet -- where there is no
// session.
//
// Google ({ wallet: 'google' }): the pass is sent to Google as it is now, and
// the answer is Google's save page for it; the 15-minute cron keeps it current
// from then on (server/utils/googleWallet.ts). It is this route rather than a
// sibling of its own because one more typed route under server/api tips
// $fetch's route types into TS2589 in unrelated components.
export default defineEventHandler(async (event) => {
  const google = (await readBody<{ wallet?: string } | null>(event).catch(() => null))?.wallet === 'google'
  const c = google ? googleWalletConfig() : null
  if (google ? !c : !walletEnabled()) throw createError({ statusCode: 503, statusMessage: `${google ? 'Google' : 'Apple'} Wallet is not set up` })
  const id = getRouterParam(event, 'id')
  const { supabase } = await requireAuthedUser(event)
  const { data } = await supabase.from('package_purchases').select('id').eq('id', id!).maybeSingle()
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Bono not found' })
  const origin = getRequestURL(event).origin

  if (!c) {
    const expires = Date.now() + 10 * 60_000
    return { url: `${origin}/api/wallet/bono/${data.id}/pass?e=${expires}&t=${walletLinkToken(data.id, expires)}` }
  }
  const service = serverSupabaseServiceRole<Database>(event)
  const pass = await loadBonoPass(service, data.id, { logoBytes: false })
  if (!pass) throw createError({ statusCode: 404, statusMessage: 'Bono not found' })
  try {
    await sendGoogleBono(c, pass, origin)
  } catch (e) {
    console.error(e)
    throw createError({ statusCode: 502, statusMessage: 'Google Wallet did not accept the pass. Try again in a moment.' })
  }
  await service.from('wallet_passes').update({ google_synced_at: new Date().toISOString() }).eq('package_purchase_id', data.id)
  return { url: googleBonoSaveUrl(c, data.id, origin) }
})
