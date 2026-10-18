import { createSign } from 'node:crypto'
import type { BonoPassData } from './walletPkpass'

// The Google Wallet pass itself, with no Nuxt in it (unit-tested in
// tests/unit/google-wallet-pass.test.ts): the class every bono shares, the
// object for one bono, and the signed "save to Google Wallet" link.
// server/utils/googleWallet.ts reads the configuration, talks to the API and
// calls these.
//
// A generic pass: one class for every clinic (<issuer>.quiroflow_bono), and
// each object carries its clinic's name, colour and logo, as Apple's does.
// The card's front shows two of the text modules -- sessions left and the
// next visit -- through the class's row template.

export const GOOGLE_WALLET_CLASS = 'quiroflow_bono'
/** QuiroFlow's mark, for a clinic with no logo of its own. Google fetches it, so it is an absolute public URL. */
export const GOOGLE_WALLET_DEFAULT_LOGO = 'https://app.quiroflow.com/logo/quiroflow-wallet.png'

export interface GoogleServiceAccount {
  client_email: string
  private_key: string
}

export const googleClassId = (issuerId: string) => `${issuerId}.${GOOGLE_WALLET_CLASS}`
export const googleObjectId = (issuerId: string, purchaseId: string) => `${issuerId}.bono-${purchaseId}`

const es = (value: string) => ({ defaultValue: { language: 'es', value } })

/** "#1F5F57" → "#1f5f57"; anything unreadable → QuiroFlow's green, as on the Apple pass. */
function hex(color: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color ?? '')
  return m ? `#${m[1]!.toLowerCase()}` : '#1f5f57'
}

/** The class every bono pass shares: which modules the card's front shows. */
export function googleBonoClass(issuerId: string) {
  const field = (id: string) => ({ firstValue: { fields: [{ fieldPath: `object.textModulesData['${id}']` }] } })
  return {
    id: googleClassId(issuerId),
    // The first account to save a bono keeps it: a forwarded link adds
    // nothing to anyone else's Wallet.
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [{ twoItems: { startItem: field('left'), endItem: field('next') } }],
      },
    },
  }
}

/**
 * The object for one bono. Google downloads the logo when the object is sent
 * and refuses the whole object if it cannot, so `logo: false` leaves it out --
 * the retry for a logo that will not load (server/utils/googleWallet.ts).
 */
export function googleBonoObject(d: BonoPassData & { logoUrl?: string | null }, issuerId: string, origin: string, opts: { logo?: boolean } = {}) {
  const left = Math.max(0, d.total - d.used)
  const when = d.nextVisit
    ? new Date(d.nextVisit.startsAt).toLocaleString('es-ES', { timeZone: d.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Sin cita reservada'
  const clinicInfo = [d.clinicAddress, d.clinicPhone].filter(Boolean).join('\n')
  return {
    id: googleObjectId(issuerId, d.purchaseId),
    classId: googleClassId(issuerId),
    // A closed bono goes to "Expired passes" on the phone, as Apple voids it.
    state: d.closed ? 'INACTIVE' : 'ACTIVE',
    cardTitle: es(d.clinicName),
    subheader: es('Bono'),
    header: es(d.bono),
    hexBackgroundColor: hex(d.brandColor),
    ...(opts.logo === false ? {} : { logo: { sourceUri: { uri: d.logoUrl || GOOGLE_WALLET_DEFAULT_LOGO }, contentDescription: es(d.clinicName) } }),
    textModulesData: [
      { id: 'left', header: 'Quedan', body: `${left} de ${d.total}` },
      { id: 'next', header: 'Próxima visita', body: d.nextVisit?.what ? `${when} · ${d.nextVisit.what}` : when },
      { id: 'holder', header: 'Titular', body: d.holder },
      ...(d.nextVisit?.who ? [{ id: 'with', header: 'Con', body: d.nextVisit.who }] : []),
      { id: 'clinic', header: d.clinicName, body: clinicInfo || d.accountName },
      { id: 'about', header: 'Esta tarjeta', body: 'Se actualiza sola al usar una sesión o reservar. Enséñala en recepción.' },
    ],
    ...(d.clinicPhone ? { linksModuleData: { uris: [{ id: 'phone', uri: `tel:${d.clinicPhone.replace(/[^\d+]/g, '')}`, description: 'Llamar a la clínica' }] } } : {}),
    barcode: { type: 'QR_CODE', value: `${origin}/patients/${d.patientId}`, alternateText: 'Enséñalo en recepción' },
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

/**
 * The "save to Google Wallet" link for an object already sent to the API.
 * The JWT only names it: the object itself lives on Google's side, which is
 * also what keeps the link short.
 */
export function googleSaveUrl(account: GoogleServiceAccount, objectId: string, origin: string, now = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(now / 1000),
      origins: [origin],
      payload: { genericObjects: [{ id: objectId }] },
    }),
  )
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key, 'base64url')
  return `https://pay.google.com/gp/v/save/${header}.${claims}.${signature}`
}
