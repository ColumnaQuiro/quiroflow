import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import forge from 'node-forge'
import { createZip } from './zipStore'
import { WALLET_IMAGES } from './walletImages'
import { APPLE_WWDR_G4 } from './walletAppleWwdr'

// The Apple Wallet pass itself, with no Nuxt in it (unit-tested in
// tests/unit/wallet-pass.test.ts): pass.json for a bono, the signed .pkpass,
// and the ten-minute link token. server/utils/walletPass.ts reads the
// configuration and the data and calls these.
//
// A .pkpass is a ZIP of pass.json, the images, manifest.json (SHA-1 of each
// file) and `signature`: a PKCS#7 detached signature of the manifest by the
// pass type certificate, carrying Apple's WWDR intermediate -- Wallet refuses
// anything else.

export const WALLET_PASS_TYPE_ID = 'pass.com.quiroflow.bono'
export const WALLET_TEAM_ID = 'N5TP24Q7MW'

export interface WalletSigning { cert: forge.pki.Certificate; key: forge.pki.PrivateKey; wwdr: forge.pki.Certificate; keyPem: string }
/** The signing material from the two PEMs; Apple's WWDR G4 is built in. */
export function walletSigningFromPem(certPem: string, keyPem: string): WalletSigning {
  return { cert: forge.pki.certificateFromPem(certPem), key: forge.pki.privateKeyFromPem(keyPem), wwdr: forge.pki.certificateFromPem(APPLE_WWDR_G4), keyPem }
}

// The "add to Wallet" link is opened in Safari, which has no session: it is
// signed instead, with a key derived from the pass key.
const linkKey = (s: WalletSigning) => createHash('sha256').update(`wallet-link:${s.keyPem}`).digest()
export function walletLinkTokenWith(s: WalletSigning, purchaseId: string, expires: number): string {
  return createHmac('sha256', linkKey(s)).update(`${purchaseId}.${expires}`).digest('base64url')
}
export function walletLinkValidWith(s: WalletSigning, purchaseId: string, expires: number, token: string, now = Date.now()): boolean {
  if (!Number.isFinite(expires) || expires < now) return false
  const want = Buffer.from(walletLinkTokenWith(s, purchaseId, expires))
  const got = Buffer.from(token)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** "#1F5F57" → "rgb(31,95,87)"; anything unreadable → null. */
function rgb(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const css = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`
const lightness = (c: [number, number, number]) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255

export interface BonoPassData {
  purchaseId: string
  patientId: string
  holder: string
  bono: string
  total: number
  used: number
  closed: boolean
  accountName: string
  clinicName: string
  clinicPhone: string | null
  clinicAddress: string | null
  timezone: string
  brandColor: string | null
  logo: Uint8Array | null
  nextVisit: { startsAt: string; what: string | null; who: string | null } | null
  authToken: string
}

/** pass.json for a bono. */
export function bonoPassJson(d: BonoPassData, origin: string) {
  const left = Math.max(0, d.total - d.used)
  const bg = rgb(d.brandColor) ?? [31, 95, 87]
  const light = lightness(bg) > 0.62
  const when = d.nextVisit
    ? new Date(d.nextVisit.startsAt).toLocaleString('es-ES', { timeZone: d.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Sin cita reservada'
  return {
    formatVersion: 1,
    passTypeIdentifier: WALLET_PASS_TYPE_ID,
    teamIdentifier: WALLET_TEAM_ID,
    serialNumber: d.purchaseId,
    webServiceURL: `${origin}/api/wallet`,
    authenticationToken: d.authToken,
    organizationName: d.accountName,
    description: `${d.bono} · ${d.clinicName}`,
    logoText: d.clinicName,
    backgroundColor: css(bg),
    foregroundColor: light ? 'rgb(21,23,30)' : 'rgb(255,255,255)',
    labelColor: light ? 'rgb(70,74,90)' : 'rgb(225,232,230)',
    ...(d.closed || left === 0 ? { voided: d.closed } : {}),
    ...(d.nextVisit && Date.parse(d.nextVisit.startsAt) > Date.now() ? { relevantDate: d.nextVisit.startsAt } : {}),
    storeCard: {
      headerFields: [{ key: 'left', label: 'QUEDAN', value: left, changeMessage: 'Te quedan %@ sesiones en tu bono' }],
      primaryFields: [{ key: 'bono', label: 'BONO', value: d.bono }],
      secondaryFields: [
        { key: 'next', label: 'PRÓXIMA VISITA', value: when, changeMessage: 'Próxima visita: %@' },
        { key: 'holder', label: 'TITULAR', value: d.holder },
      ],
      auxiliaryFields: d.nextVisit?.who ? [{ key: 'with', label: 'CON', value: d.nextVisit.who }] : [],
      backFields: [
        { key: 'sessions', label: 'Sesiones', value: `${d.used} usadas de ${d.total}` },
        ...(d.nextVisit?.what ? [{ key: 'type', label: 'Próxima visita', value: `${when} · ${d.nextVisit.what}` }] : []),
        { key: 'clinic', label: d.clinicName, value: [d.clinicAddress, d.clinicPhone].filter(Boolean).join('\n') || d.accountName },
        { key: 'about', label: 'Esta tarjeta', value: 'Se actualiza sola al usar una sesión o reservar. Enséñala en recepción.' },
      ],
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: `${origin}/patients/${d.patientId}`, messageEncoding: 'iso-8859-1', altText: 'Enséñalo en recepción' }],
  }
}

const sha1 = (data: Uint8Array) => createHash('sha1').update(data).digest('hex')

/** The signed .pkpass for a bono. */
export function buildBonoPkpass(d: BonoPassData, origin: string, s: WalletSigning): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'pass.json': new TextEncoder().encode(JSON.stringify(bonoPassJson(d, origin))),
  }
  for (const [name, b64] of Object.entries(WALLET_IMAGES)) files[name] = Uint8Array.from(Buffer.from(b64, 'base64'))
  if (d.logo) {
    files['logo.png'] = d.logo
    delete files['logo@2x.png']
    delete files['logo@3x.png']
  }
  const manifest = JSON.stringify(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha1(b)])))

  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(manifest, 'utf8')
  p7.addCertificate(s.cert)
  p7.addCertificate(s.wwdr)
  p7.addSigner({
    key: s.key as forge.pki.rsa.PrivateKey,
    certificate: s.cert,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime!, value: new Date() as unknown as string },
    ],
  })
  p7.sign({ detached: true })
  const signature = Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary')

  return createZip([
    ...Object.entries(files).map(([name, data]) => ({ name, data })),
    { name: 'manifest.json', data: manifest },
    { name: 'signature', data: new Uint8Array(signature) },
  ])
}
