import { describe, it, expect } from 'vitest'
import { VERIFACTU_QR_BASE_URL, verifactuQrUrl } from '../../utils/verifactuQr'

// The QR on every factura points at the AEAT's cotejo service with the four
// values it compares against the registro it holds. Any difference -- a date
// in the wrong order, an "&" left unencoded, an amount with a comma -- and
// the patient is told the factura does not exist.
describe('The VERI*FACTU QR on a factura', () => {
  const record = { issuerNif: 'B16365504', serieNumber: 'F-2027-0001', issuedOn: '2027-01-04', importeTotalCents: 4400, environment: 'production' as const }

  it('points at the real service for a production record, with the four values', () => {
    expect(verifactuQrUrl(record)).to.eq(
      'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B16365504&numserie=F-2027-0001&fecha=04-01-2027&importe=44.00',
    )
  })

  it('points at the test service for a record in the test chain', () => {
    expect(verifactuQrUrl({ ...record, environment: 'test' })).to.match(new RegExp(`^${VERIFACTU_QR_BASE_URL.test.replace(/[.?]/g, '\\$&')}\\?`))
  })

  it('encodes a serie number the way the AEAT spec shows, so an "&" is not a fifth parameter', () => {
    // The spec's own example: numserie 12345678&G33 must travel as %26.
    const url = verifactuQrUrl({ issuerNif: '89890001K', serieNumber: '12345678&G33', issuedOn: '2024-01-01', importeTotalCents: 24140, environment: 'test' })
    expect(url).to.eq('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.40')
    expect(new URL(url).searchParams.get('numserie')).to.eq('12345678&G33')
    expect([...new URL(url).searchParams.keys()]).to.deep.eq(['nif', 'numserie', 'fecha', 'importe'])
  })

  it('writes a rectificativa\'s negative total the way its registro does', () => {
    expect(new URL(verifactuQrUrl({ ...record, serieNumber: 'R-2027-0001', importeTotalCents: -4400 })).searchParams.get('importe')).to.eq('-44.00')
  })

  it('never asks for the machine-readable answer, which the AEAT forbids in the QR', () => {
    expect(verifactuQrUrl(record)).not.to.contain('formato')
  })
})
