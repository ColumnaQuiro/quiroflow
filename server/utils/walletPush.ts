import { connect } from 'node:http2'
import forge from 'node-forge'
import { walletSigning } from '~/server/utils/walletPass'
import { WALLET_PASS_TYPE_ID } from '~/server/utils/walletPkpass'

// Telling the devices that hold a pass to fetch it again: an empty APNs push
// to each, authenticated with the pass type certificate itself (passes do
// not take token auth), topic = the pass type id. The device then asks the
// web service what changed (server/api/wallet/v1/*). Runs from the daily
// cron for every pass whose updated_at is past its pushed_at.

type Service = any

async function pushTo(tokens: string[]): Promise<{ sent: number; gone: string[] }> {
  const s = walletSigning()
  if (!s || !tokens.length) return { sent: 0, gone: [] }
  const client = connect('https://api.push.apple.com:443', { cert: forge.pki.certificateToPem(s.cert), key: s.keyPem })
  let sent = 0
  const gone: string[] = []
  try {
    await Promise.all(
      tokens.map(
        (token) =>
          new Promise<void>((resolve) => {
            const req = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, 'apns-topic': WALLET_PASS_TYPE_ID, 'apns-push-type': 'background', 'content-type': 'application/json' })
            req.on('response', (h) => {
              const status = Number(h[':status'])
              if (status === 200) sent++
              // 410: the device removed the pass or the app; stop asking.
              if (status === 410 || status === 400) gone.push(token)
            })
            req.on('error', () => resolve())
            req.on('close', () => resolve())
            req.end('{}')
          }),
      ),
    )
  } finally {
    client.close()
  }
  return { sent, gone }
}

/** Pushes every pass changed since it was last pushed, to the devices that hold it. */
export async function pushChangedWalletPasses(service: Service, now = new Date()) {
  if (!walletSigning()) return 0
  const { data: passes } = await service.from('wallet_passes').select('package_purchase_id, updated_at, pushed_at').limit(500)
  const changed = ((passes as { package_purchase_id: string; updated_at: string; pushed_at: string | null }[] | null) ?? []).filter((p) => !p.pushed_at || p.updated_at > p.pushed_at)
  if (!changed.length) return 0
  const ids = changed.map((p) => p.package_purchase_id)
  const { data: regs } = await service.from('wallet_registrations').select('push_token, package_purchase_id').in('package_purchase_id', ids)
  const tokens = [...new Set(((regs as { push_token: string }[] | null) ?? []).map((r) => r.push_token))]
  try {
    const { sent, gone } = await pushTo(tokens)
    if (gone.length) await service.from('wallet_registrations').delete().in('push_token', gone)
    await service.from('wallet_passes').update({ pushed_at: now.toISOString() }).in('package_purchase_id', ids)
    return sent
  } catch (e) {
    console.error('[wallet] push failed', e)
    return 0
  }
}
