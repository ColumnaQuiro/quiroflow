import { createSign } from 'node:crypto'
import { loadBonoPass } from '~/server/utils/walletPass'
import { googleBonoClass, googleBonoObject, googleClassId, googleObjectId, googleSaveUrl, type GoogleServiceAccount } from '~/server/utils/googleWalletPass'
import type { BonoPassData } from '~/server/utils/walletPkpass'

// A bono in Google Wallet: the configuration (the issuer and the service
// account allowed to issue for it) and the API calls. The pass itself is
// server/utils/googleWalletPass.ts.
//
// Unlike Apple's, the pass lives on Google's servers: we send the object,
// and Google syncs it to every phone holding it. So "keeping it current" is
// sending it again -- the 15-minute cron does, for every bono whose
// wallet_passes.updated_at is past its google_synced_at.
//
// NUXT_GOOGLE_WALLET_ISSUER_ID is the issuer in the Pay & Wallet Console
// (owned by hola@columnaquiro.com); NUXT_GOOGLE_WALLET_KEY is that service
// account's JSON key, base64-encoded. The service account is a Developer
// user of the issuer, which is all it needs.

type Service = any
const API = 'https://walletobjects.googleapis.com/walletobjects/v1'

interface GoogleWalletConfig {
  issuerId: string
  account: GoogleServiceAccount
}
let config: GoogleWalletConfig | null | undefined
/** The issuer and service account from the runtime config, or null when Google Wallet is not configured. */
export function googleWalletConfig(runtime = useRuntimeConfig()): GoogleWalletConfig | null {
  if (config !== undefined) return config
  const issuerId = String(runtime.googleWalletIssuerId ?? '').trim()
  const raw = runtime.googleWalletKey as unknown
  let account: GoogleServiceAccount | null = null
  try {
    // base64 is what is configured; plain JSON is accepted too, and Nitro
    // hands a JSON-looking env var over already parsed (see pushNotifications.ts).
    const parsed = typeof raw === 'string' && raw ? JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) : raw
    if (parsed && typeof parsed === 'object' && 'client_email' in parsed && 'private_key' in parsed) account = parsed as GoogleServiceAccount
  } catch {
    console.error('[google-wallet] NUXT_GOOGLE_WALLET_KEY is not a service account key')
  }
  config = issuerId && account ? { issuerId, account } : null
  return config
}
export function googleWalletEnabled() {
  return !!googleWalletConfig()
}

let token: { value: string; expiresAt: number } | null = null
async function accessToken(account: GoogleServiceAccount): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url')
  const res = await $fetch<{ access_token: string; expires_in: number }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  token = { value: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 }
  return res.access_token
}

class GoogleWalletError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`[google-wallet] ${status} ${JSON.stringify(body)}`)
  }
}

/** Inserts the resource, or replaces it when Google already has one with that id. */
async function put(c: GoogleWalletConfig, kind: 'genericClass' | 'genericObject', body: { id: string }) {
  const headers = { Authorization: `Bearer ${await accessToken(c.account)}` }
  let res = await $fetch.raw(`${API}/${kind}`, { method: 'POST', body, headers, ignoreResponseError: true })
  if (res.status === 409) res = await $fetch.raw(`${API}/${kind}/${encodeURIComponent(body.id)}`, { method: 'PUT', body, headers, ignoreResponseError: true })
  if (!res.ok) throw new GoogleWalletError(res.status, res._data)
}

// The class changes only with a deploy, so once per server instance is enough.
let classSent = false
/** Sends the bono's object (and, first time round, the class), so Google has what the pass shows now. */
export async function sendGoogleBono(c: GoogleWalletConfig, d: BonoPassData & { logoUrl?: string | null }, origin: string) {
  if (!classSent) {
    await put(c, 'genericClass', googleBonoClass(c.issuerId))
    classSent = true
  }
  try {
    await put(c, 'genericObject', googleBonoObject(d, c.issuerId, origin))
  } catch (e) {
    // "Could not load image": the clinic's logo (or ours, before a deploy
    // has published it) is not reachable. A pass with no logo beats no pass.
    if (!(e instanceof GoogleWalletError && e.status === 400 && /image/i.test(JSON.stringify(e.body)))) throw e
    console.error('[google-wallet] logo refused, sending without it', d.logoUrl)
    await put(c, 'genericObject', googleBonoObject(d, c.issuerId, origin, { logo: false }))
  }
}

/** The "save to Google Wallet" link for a bono already sent. */
export function googleBonoSaveUrl(c: GoogleWalletConfig, purchaseId: string, origin: string) {
  return googleSaveUrl(c.account, googleObjectId(c.issuerId, purchaseId), origin)
}

/** Sends again every bono in Google Wallet whose pass changed since it was last sent. */
export async function syncChangedGoogleWalletPasses(service: Service, origin: string, now = new Date()) {
  const c = googleWalletConfig()
  if (!c) return 0
  const { data: passes } = await service.from('wallet_passes').select('package_purchase_id, updated_at, google_synced_at').not('google_synced_at', 'is', null).limit(500)
  // A bounded batch per run; the rest are picked up a quarter of an hour later.
  const changed = ((passes as { package_purchase_id: string; updated_at: string; google_synced_at: string }[] | null) ?? []).filter((p) => p.updated_at > p.google_synced_at).slice(0, 50)
  let sent = 0
  for (const p of changed) {
    try {
      const data = await loadBonoPass(service, p.package_purchase_id, { logoBytes: false })
      if (data) await sendGoogleBono(c, data, origin)
      await service.from('wallet_passes').update({ google_synced_at: now.toISOString() }).eq('package_purchase_id', p.package_purchase_id)
      sent++
    } catch (e) {
      console.error('[google-wallet] sync failed', p.package_purchase_id, e)
    }
  }
  return sent
}
