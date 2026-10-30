import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { deriveCheckInCodeKey, signCheckInCode, verifyCheckInCode } from '../../server/utils/checkInCode'
import { PORTAL_LANGUAGES, PORTAL_LANGUAGE_NAMES, PORTAL_LOCALES, PORTAL_TEXT } from '../../utils/checkInPortalText'

// The QR code in the app that checks a patient in at the front-desk tablet:
// it names one patient, and cannot be made up or edited to name another.
const key = deriveCheckInCodeKey('test-secret')
const patient = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'

describe('check-in QR codes', () => {
  it('verifies a code it signed, back to the patient', () => {
    const code = signCheckInCode(key, patient)
    expect(code).toMatch(/^qfci\.3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e\.[A-Za-z0-9_-]{32}$/)
    expect(verifyCheckInCode(key, code)).toBe(patient)
    // A scanner may add a trailing newline or space.
    expect(verifyCheckInCode(key, `${code}\n`)).toBe(patient)
  })
  it('refuses another patient’s id under the same signature, and another deployment’s key', () => {
    const code = signCheckInCode(key, patient)
    const edited = code.replace('3f2b8c1e', '3f2b8c1f')
    expect(verifyCheckInCode(key, edited)).toBeNull()
    expect(verifyCheckInCode(deriveCheckInCodeKey('other-secret'), code)).toBeNull()
  })
  it('survives the trip through a QR code as the server draws it and the tablet’s camera reads it', () => {
    const code = signCheckInCode(key, patient)
    // The same options as check-in-code.get.ts, painted 8 px a module with a
    // 4-module quiet zone, as a camera frame would show it.
    const qr = QRCode.create(code, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    const scale = 8
    const side = (n + 8) * scale
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.modules.get(y, x)) continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
          }
        }
      }
    }
    const read = jsQR(pixels, side, side)
    expect(read?.data).toBe(code)
    expect(verifyCheckInCode(key, read!.data)).toBe(patient)
  })
  it('refuses anything that is not a code', () => {
    expect(verifyCheckInCode(key, '')).toBeNull()
    expect(verifyCheckInCode(key, 'https://example.com')).toBeNull()
    expect(verifyCheckInCode(key, `p.${patient}.abc`)).toBeNull()
    expect(verifyCheckInCode(key, `qfci.not-a-uuid.${'a'.repeat(32)}`)).toBeNull()
  })
})

describe('check-in portal text', () => {
  it('has every line in every language, and a name and locale for each', () => {
    const keys = Object.keys(PORTAL_TEXT.es).sort()
    for (const lang of PORTAL_LANGUAGES) {
      expect(Object.keys(PORTAL_TEXT[lang]).sort()).toEqual(keys)
      expect(PORTAL_LANGUAGE_NAMES[lang]).toBeTruthy()
      expect(PORTAL_LOCALES[lang]).toBeTruthy()
      expect(PORTAL_TEXT[lang].hello('Ana')).toContain('Ana')
      expect(PORTAL_TEXT[lang].yourVisit('10:30', 'Léa')).toContain('Léa')
      expect(PORTAL_TEXT[lang].yourVisit('10:30', null)).not.toContain('null')
    }
  })
})
