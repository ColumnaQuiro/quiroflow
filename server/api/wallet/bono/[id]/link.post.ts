import { walletEnabled, walletLinkToken } from '~/server/utils/walletPass'

// "Añadir a Apple Wallet" on a bono (the patient's app or portal): a link to
// the .pkpass, signed for ten minutes, because it is opened in Safari --
// which adds it to Wallet -- where there is no session. Who may have it is
// the read below, as the caller: the "patients view own package_purchases"
// policy, or a staff member's own.
export default defineEventHandler(async (event) => {
  if (!walletEnabled()) throw createError({ statusCode: 503, statusMessage: 'Apple Wallet is not set up' })
  const id = getRouterParam(event, 'id')
  const { supabase } = await requireAuthedUser(event)
  const { data } = await supabase.from('package_purchases').select('id').eq('id', id!).maybeSingle()
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Bono not found' })
  const expires = Date.now() + 10 * 60_000
  return { url: `${getRequestURL(event).origin}/api/wallet/bono/${data.id}/pass?e=${expires}&t=${walletLinkToken(data.id, expires)}` }
})
