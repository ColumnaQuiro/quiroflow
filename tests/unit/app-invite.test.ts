import { describe, it, expect } from 'vitest'
import { appInviteText } from '../../utils/appInvite'
import { appStoreUrl, playStoreUrl } from '../../utils/appLinks'

// The invite reception copies from a patient's record. It is read by the
// patient, so it follows their language, and it has to carry everything the
// app's first screen asks for: the store links and the clinic code.

describe('appInviteText', () => {
  const base = { firstName: 'Ana', clinicName: 'Clínica Demo', code: 'clinica-demo' }

  it('is in Spanish by default, with both stores and the clinic code', () => {
    const text = appInviteText({ ...base, language: null })
    expect(text).toContain('Hola Ana')
    expect(text).toContain('Clínica Demo')
    expect(text).toContain(appStoreUrl()!)
    expect(text).toContain(playStoreUrl())
    expect(text).toContain('código de la clínica clinica-demo')
  })

  it('follows the patient language for English and French', () => {
    expect(appInviteText({ ...base, language: 'en' })).toContain('Hi Ana, download the QuiroFlow app')
    expect(appInviteText({ ...base, language: 'fr' })).toContain('Bonjour Ana, téléchargez')
  })

  it('reads Spanish for a language it has no text for', () => {
    expect(appInviteText({ ...base, language: 'de' })).toContain('Hola Ana')
  })

  it('still reads without a first name', () => {
    expect(appInviteText({ ...base, firstName: null, language: 'es' }).startsWith('Descarga la app QuiroFlow')).toBe(true)
  })
})
