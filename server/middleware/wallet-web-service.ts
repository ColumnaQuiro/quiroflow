import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requireWalletPass } from '~/server/utils/walletAuth'
import { loadBonoPass, walletSigning } from '~/server/utils/walletPass'
import { buildBonoPkpass, WALLET_PASS_TYPE_ID } from '~/server/utils/walletPkpass'

// Apple's PassKit web service, at the pass's webServiceURL (/api/wallet):
//
//   POST   v1/devices/<device>/registrations/<type>/<serial>   the pass was added on a device
//   DELETE v1/devices/<device>/registrations/<type>/<serial>   ...and removed
//   GET    v1/devices/<device>/registrations/<type>            which of its passes changed since a tag
//   GET    v1/passes/<type>/<serial>                           the latest pass, after a push
//   POST   v1/log                                              the device reporting a problem
//
// A server middleware, not an API route: as a route (one catch-all, or the
// five nested ones Apple's paths imply) it joins Nitro's typed route union
// as a template-literal type, and checking any $fetch call against that was
// more than TypeScript will instantiate (TS2589) -- in files that have
// nothing to do with Wallet. Calls about one pass carry
// "Authorization: ApplePass <its token>" (requireWalletPass).
const PREFIX = '/api/wallet/v1/'

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith(PREFIX)) return
  const parts = event.path.slice(PREFIX.length).split('?')[0]!.split('/').filter(Boolean).map(decodeURIComponent)
  const method = event.method

  if (parts[0] === 'log' && method === 'POST') {
    const body = await readBody<{ logs?: string[] }>(event)
    for (const line of (body?.logs ?? []).slice(0, 20)) console.warn('[wallet] device log:', String(line).slice(0, 500))
    return ''
  }

  if (parts[0] === 'passes' && parts.length === 3 && method === 'GET') {
    const { service, pass } = await requireWalletPass(event, parts[1], parts[2])
    const since = getHeader(event, 'if-modified-since')
    const updated = new Date(pass.updated_at)
    if (since && !Number.isNaN(Date.parse(since)) && Math.floor(updated.getTime() / 1000) <= Math.floor(Date.parse(since) / 1000)) {
      setResponseStatus(event, 304)
      return ''
    }
    const data = await loadBonoPass(service, pass.package_purchase_id)
    const signing = walletSigning()
    if (!data || !signing) throw createError({ statusCode: 401 })
    setHeader(event, 'Content-Type', 'application/vnd.apple.pkpass')
    setHeader(event, 'Last-Modified', updated.toUTCString())
    return buildBonoPkpass(data, getRequestURL(event).origin, signing)
  }

  if (parts[0] === 'devices' && parts[2] === 'registrations') {
    const device = parts[1] ?? ''
    if (!/^[\w-]{1,128}$/.test(device)) throw createError({ statusCode: 400 })

    // Which of this device's passes changed since the tag it last got (an ISO
    // timestamp). No auth header on this call, by Apple's design: a device id
    // only ever learns about passes registered to it. 204 when nothing changed.
    if (parts.length === 4 && method === 'GET') {
      if (parts[3] !== WALLET_PASS_TYPE_ID) throw createError({ statusCode: 404 })
      const service = serverSupabaseServiceRole<Database>(event)
      const { data: regs } = await service.from('wallet_registrations').select('package_purchase_id').eq('device_library_id', device)
      const ids = (regs ?? []).map((r) => r.package_purchase_id)
      const since = String(getQuery(event).passesUpdatedSince ?? '')
      let q = service.from('wallet_passes').select('package_purchase_id, updated_at').in('package_purchase_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      if (since && !Number.isNaN(Date.parse(since))) q = q.gt('updated_at', since)
      const { data: passes } = await q
      if (!passes?.length) {
        setResponseStatus(event, 204)
        return ''
      }
      return { serialNumbers: passes.map((p) => p.package_purchase_id), lastUpdated: passes.map((p) => p.updated_at).sort().at(-1) }
    }

    if (parts.length === 5) {
      const { service, pass } = await requireWalletPass(event, parts[3], parts[4])
      if (method === 'POST') {
        const body = await readBody<{ pushToken?: string }>(event)
        if (!body?.pushToken || !/^[0-9a-fA-F]{32,200}$/.test(body.pushToken)) throw createError({ statusCode: 400 })
        const { data: existing } = await service.from('wallet_registrations').select('device_library_id').eq('device_library_id', device).eq('package_purchase_id', pass.package_purchase_id).maybeSingle()
        await service.from('wallet_registrations').upsert({ device_library_id: device, package_purchase_id: pass.package_purchase_id, push_token: body.pushToken }, { onConflict: 'device_library_id,package_purchase_id' })
        setResponseStatus(event, existing ? 200 : 201)
        return ''
      }
      if (method === 'DELETE') {
        await service.from('wallet_registrations').delete().eq('device_library_id', device).eq('package_purchase_id', pass.package_purchase_id)
        return ''
      }
    }
  }
  throw createError({ statusCode: 404 })
})
