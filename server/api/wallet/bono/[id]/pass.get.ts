import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loadBonoPass, walletLinkValid, walletSigning } from '~/server/utils/walletPass'
import { buildBonoPkpass } from '~/server/utils/walletPkpass'

// The bono's .pkpass, from the signed link api/wallet/bono/<id>/link hands
// out. Safari on an iPhone offers "Add to Wallet"; elsewhere it downloads.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const q = getQuery(event)
  if (!walletLinkValid(id, Number(q.e), String(q.t ?? ''))) throw createError({ statusCode: 403, statusMessage: 'This link has expired. Open your bono again.' })
  const service = serverSupabaseServiceRole<Database>(event)
  const data = await loadBonoPass(service, id)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Bono not found' })
  setHeader(event, 'Content-Type', 'application/vnd.apple.pkpass')
  setHeader(event, 'Content-Disposition', `attachment; filename="bono.pkpass"`)
  return buildBonoPkpass(data, getRequestURL(event).origin, walletSigning()!)
})
