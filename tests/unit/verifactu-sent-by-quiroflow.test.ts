import { describe, it, expect } from 'vitest'
import { certificateAccountFor, isNotAuthorisedToSend } from '../../utils/verifactuSoap'

// Settings > VeriFactu > Who sends: a clinic's own certificate, or QuiroFlow's
// once the clinic's authorisation has been accepted.
describe('Whose certificate sends a clinic’s records', () => {
  const clinic = 'clinic-account'
  const platform = 'platform-account'
  const accepted = '2026-10-01T09:00:00Z'

  it('is the clinic’s own when it sends for itself, whatever else is on file', () => {
    expect(certificateAccountFor({ accountId: clinic, sender: 'own_certificate', delegation: { route: 'apoderamiento', acceptedAt: accepted }, platformAccountId: platform }))
      .to.deep.eq({ accountId: clinic, blocked: null })
    expect(certificateAccountFor({ accountId: clinic, sender: undefined, delegation: null, platformAccountId: platform }).accountId).to.eq(clinic)
  })

  it('is QuiroFlow’s once the authorisation is accepted', () => {
    for (const route of ['apoderamiento', 'colaboracion_social']) {
      expect(certificateAccountFor({ accountId: clinic, sender: route, delegation: { route, acceptedAt: accepted }, platformAccountId: platform }))
        .to.deep.eq({ accountId: platform, blocked: null })
    }
  })

  it('sends nothing before then: the AEAT would refuse every record with 4112', () => {
    expect(certificateAccountFor({ accountId: clinic, sender: 'apoderamiento', delegation: { route: 'apoderamiento', acceptedAt: null }, platformAccountId: platform }).blocked)
      .to.eq('delegation-not-accepted')
    expect(certificateAccountFor({ accountId: clinic, sender: 'apoderamiento', delegation: null, platformAccountId: platform }).blocked)
      .to.eq('delegation-not-accepted')
  })

  it('does not carry an acceptance from one route over to the other', () => {
    expect(certificateAccountFor({ accountId: clinic, sender: 'colaboracion_social', delegation: { route: 'apoderamiento', acceptedAt: accepted }, platformAccountId: platform }).blocked)
      .to.eq('delegation-not-accepted')
  })

  it('says so when this environment has no platform account to send with', () => {
    expect(certificateAccountFor({ accountId: clinic, sender: 'apoderamiento', delegation: { route: 'apoderamiento', acceptedAt: accepted }, platformAccountId: null }).blocked)
      .to.eq('no-platform-certificate')
  })
})

describe('The AEAT’s 4112, “not allowed to send for this NIF”', () => {
  it('is recognised as a record’s error code', () => {
    expect(isNotAuthorisedToSend('4112', 'El titular del certificado debe ser Obligado Emisión, Colaborador Social, Apoderado o Sucesor')).to.eq(true)
  })

  it('is recognised inside a SOAP fault', () => {
    expect(isNotAuthorisedToSend(null, 'AEAT fault env:Client: Codigo[4112].El titular del certificado debe ser Obligado Emisión')).to.eq(true)
  })

  it('is not confused with other codes that contain the digits', () => {
    expect(isNotAuthorisedToSend('41120', null)).to.eq(false)
    expect(isNotAuthorisedToSend('2004', 'margen de error de 240 segundos')).to.eq(false)
  })
})
