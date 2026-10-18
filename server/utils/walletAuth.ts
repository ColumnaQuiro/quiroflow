import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { WALLET_PASS_TYPE_ID } from '~/server/utils/walletPkpass'

// Apple's PassKit web service authenticates every call about one pass with
// "Authorization: ApplePass <authenticationToken>" -- the token that pass
// carries. Unknown pass type, unknown serial or the wrong token: 401, as the
// protocol asks, and nothing about which.
export async function requireWalletPass(event: H3Event, passType: string | undefined, serial: string | undefined) {
  const header = getHeader(event, 'authorization') ?? ''
  const token = header.startsWith('ApplePass ') ? header.slice('ApplePass '.length).trim() : ''
  const service = serverSupabaseServiceRole<Database>(event)
  if (passType !== WALLET_PASS_TYPE_ID || !serial || !/^[0-9a-f-]{36}$/.test(serial) || !token) throw createError({ statusCode: 401 })
  const { data } = await service.from('wallet_passes').select('package_purchase_id, auth_token, updated_at').eq('package_purchase_id', serial).maybeSingle()
  if (!data || data.auth_token !== token) throw createError({ statusCode: 401 })
  return { service, pass: data }
}
