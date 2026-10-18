import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GOOGLE_WALLET_DEFAULT_LOGO, googleBonoClass, googleBonoObject, googleClassId, googleObjectId, googleSaveUrl } from '../../server/utils/googleWalletPass'
import type { BonoPassData } from '../../server/utils/walletPkpass'

// The Google Wallet pass (server/utils/googleWalletPass.ts): what the class
// and object say, and the save link's JWT -- verified with a throwaway key,
// so nothing here needs the real service account. Google's own acceptance
// of the object needs the API.

const ISSUER = '3388000000000000000'
const data: BonoPassData & { logoUrl?: string | null } = {
  purchaseId: '6d1c2b6e-0b3f-4a4e-9a1d-2f9a7c1e5b10',
  patientId: '9a0e2c41-5d3b-4c7e-8f21-6b4d3a2e1c00',
  holder: 'Lucía Navarro',
  bono: 'Ajuste · 10 sesiones',
  total: 10,
  used: 4,
  closed: false,
  accountName: 'Clínica Demo',
  clinicName: 'Clínica Demo Centro',
  clinicPhone: '600 000 000',
  clinicAddress: 'Calle Mayor 1, Valencia',
  timezone: 'Europe/Madrid',
  brandColor: '#4F46E5',
  logo: null,
  nextVisit: { startsAt: '2026-11-03T09:30:00Z', what: 'Ajuste', who: 'Dra. Ruiz' },
  authToken: 'x',
}
const module_ = (o: ReturnType<typeof googleBonoObject>, id: string) => o.textModulesData.find((m) => m.id === id)

describe('Google Wallet bono object', () => {
  const o = googleBonoObject(data, ISSUER, 'https://app.quiroflow.com')

  it('is named by the issuer and the bono, under the shared class', () => {
    expect(o.id).toBe(`${ISSUER}.bono-${data.purchaseId}`)
    expect(o.id).toBe(googleObjectId(ISSUER, data.purchaseId))
    expect(o.classId).toBe(googleClassId(ISSUER))
    // Google allows letters, digits, '.', '_' and '-' after the issuer.
    expect(o.id.slice(ISSUER.length + 1)).toMatch(/^[\w.-]+$/)
  })

  it('shows the clinic, the bono, sessions left and the next visit in the clinic’s clock', () => {
    expect(o.cardTitle.defaultValue.value).toBe('Clínica Demo Centro')
    expect(o.header.defaultValue.value).toBe('Ajuste · 10 sesiones')
    expect(module_(o, 'left')?.body).toBe('6 de 10')
    // 09:30 UTC is 10:30 in Madrid in November.
    expect(module_(o, 'next')?.body).toContain('10:30')
    expect(module_(o, 'next')?.body).toContain('Ajuste')
    expect(module_(o, 'with')?.body).toBe('Dra. Ruiz')
    expect(module_(o, 'holder')?.body).toBe('Lucía Navarro')
    expect(o.state).toBe('ACTIVE')
  })

  it('draws it in the clinic’s colour, with its logo or QuiroFlow’s', () => {
    expect(o.hexBackgroundColor).toBe('#4f46e5')
    expect(o.logo?.sourceUri.uri).toBe(GOOGLE_WALLET_DEFAULT_LOGO)
    const own = googleBonoObject({ ...data, logoUrl: 'https://x.supabase.co/storage/v1/object/public/clinic-logos/a/b/logo.png', brandColor: null }, ISSUER, 'https://app.quiroflow.com')
    expect(own.logo?.sourceUri.uri).toContain('clinic-logos')
    expect(own.hexBackgroundColor).toBe('#1f5f57')
    // The retry for a logo Google cannot load: the same pass, without one.
    expect(googleBonoObject(data, ISSUER, 'https://app.quiroflow.com', { logo: false })).not.toHaveProperty('logo')
  })

  it('carries the reception QR, a call link, and goes inactive once the bono is closed', () => {
    expect(o.barcode).toEqual({ type: 'QR_CODE', value: `https://app.quiroflow.com/patients/${data.patientId}`, alternateText: 'Enséñalo en recepción' })
    expect(o.linksModuleData?.uris[0]?.uri).toBe('tel:600000000')
    expect(googleBonoObject({ ...data, closed: true }, ISSUER, 'https://app.quiroflow.com').state).toBe('INACTIVE')
    const bare = googleBonoObject({ ...data, nextVisit: null, clinicPhone: null }, ISSUER, 'https://app.quiroflow.com')
    expect(module_(bare, 'next')?.body).toBe('Sin cita reservada')
    expect(bare.linksModuleData).toBeUndefined()
  })

  it('fills both rows the class puts on the card front', () => {
    const cls = googleBonoClass(ISSUER)
    expect(cls.id).toBe(o.classId)
    const row = cls.classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos[0]!.twoItems
    for (const item of [row.startItem, row.endItem]) {
      const id = /textModulesData\['(\w+)'\]/.exec(item.firstValue.fields[0]!.fieldPath)![1]!
      expect(module_(o, id), id).toBeTruthy()
    }
  })
})

describe('Google Wallet save link', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const account = { client_email: 'wallet@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
  const url = googleSaveUrl(account, googleObjectId(ISSUER, data.purchaseId), 'https://app.quiroflow.com', Date.UTC(2026, 9, 18))
  const jwt = url.replace('https://pay.google.com/gp/v/save/', '')
  const [header, claims, signature] = jwt.split('.')

  it('is a save-to-wallet JWT naming the object, signed by the service account', () => {
    expect(url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true)
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const c = JSON.parse(Buffer.from(claims!, 'base64url').toString())
    expect(c).toMatchObject({ iss: account.client_email, aud: 'google', typ: 'savetowallet', origins: ['https://app.quiroflow.com'], iat: Date.UTC(2026, 9, 18) / 1000 })
    expect(c.payload).toEqual({ genericObjects: [{ id: `${ISSUER}.bono-${data.purchaseId}` }] })
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true)
  })

  it('stays short enough for a link (the object lives on Google’s side)', () => {
    expect(url.length).toBeLessThan(1000)
  })
})
