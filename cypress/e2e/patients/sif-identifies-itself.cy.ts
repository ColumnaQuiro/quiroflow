import {
  SIF_CODE,
  SIF_FIELD_LIMITS,
  SIF_ONLY_VERIFACTU,
  SIF_PRODUCER,
  SIF_SUPPORTS_MULTIPLE_OBLIGADOS,
  SIF_SYSTEM_NAME,
  SIF_VERSION,
  sifInstallationNumber,
  sifSystemBlock,
} from '../../../utils/sifIdentity'

// How the software names itself on every record it sends.
//
// The SistemaInformatico block identifies the SIF, not the clinic, and it
// rides on every alta record. Its fields are narrower than they look, and a
// value that is too long is not caught by anything we own -- it comes back as
// a rejected record from the AEAT, one per factura, after transmission has
// started. Cheaper to fail here.
//
// Limits are AEAT's (DsRegistroVeriFactu.xlsx, «5)Definición
// SistemaInformatico»).
describe('How the SIF identifies itself to the AEAT', () => {
  it('keeps every field inside the length the AEAT allows', () => {
    expect(SIF_SYSTEM_NAME.length, 'NombreSistemaInformatico').to.be.at.most(SIF_FIELD_LIMITS.NombreSistemaInformatico)

    // Two characters. This shipped as 'QF-SIF' -- six -- on the declaración
    // responsable page, which would have been rejected on every record.
    expect(SIF_CODE.length, 'IdSistemaInformatico is Alfanumérico (2)').to.eq(2)
    expect(SIF_CODE.length).to.be.at.most(SIF_FIELD_LIMITS.IdSistemaInformatico)

    expect(SIF_VERSION.length, 'Version').to.be.at.most(SIF_FIELD_LIMITS.Version)
    expect(SIF_PRODUCER.name.length, 'NombreRazon').to.be.at.most(SIF_FIELD_LIMITS.NombreRazon)

    // Read wide on purpose. SIF_PRODUCER is `as const`, so while the NIF is
    // still blank its type is the literal '' and a narrowed check would be
    // dead code the compiler rejects. This starts enforcing FormatoNIF (9)
    // the moment a real NIF is filled in, which is the point.
    const nif: string = SIF_PRODUCER.nif
    if (nif.length > 0) {
      expect(nif.length, 'NIF is FormatoNIF (9)').to.eq(SIF_FIELD_LIMITS.NIF)
    }
  })

  it('gives each clinic its own installation number', () => {
    // NumeroInstalacion must distinguish this installation from every other
    // used for the same obligado's facturación. One constant across a hosted
    // product would claim every clinic is the same installation.
    const a = sifInstallationNumber('11111111-1111-1111-1111-111111111111')
    const b = sifInstallationNumber('22222222-2222-2222-2222-222222222222')
    expect(a).to.not.eq(b)
    expect(a.length).to.be.at.most(SIF_FIELD_LIMITS.NumeroInstalacion)
  })

  it('declares VERI*FACTU-only and multi-obligado, which are commitments', () => {
    // "S" here says the system can ONLY comply by transmitting. Adding a
    // non-transmitting mode later would make every record already sent wrong
    // about the system that produced it.
    expect(SIF_ONLY_VERIFACTU).to.eq('S')
    // QuiroFlow keeps a separate series and huella chain per account.
    expect(SIF_SUPPORTS_MULTIPLE_OBLIGADOS).to.eq('S')
  })

  it('leaves IndicadorMultiplesOT to the database, which counts', () => {
    // The record design forbids this value being configured or entered by a
    // user: the system must derive it from the obligados it holds. So it is
    // deliberately absent from the block the app assembles.
    const block = sifSystemBlock('33333333-3333-3333-3333-333333333333')
    expect(block).to.not.have.property('IndicadorMultiplesOT')
    expect(block.IdSistemaInformatico).to.eq(SIF_CODE)
    expect(block.NumeroInstalacion).to.contain('33333333')

    cy.task('db:indicadorMultiplesOt').then((value: any) => {
      // This database holds many clinics, so the derived answer is 'S'. The
      // point of the assertion is that it came from a count rather than a
      // constant -- 'N' would be correct for a single-clinic install.
      expect(value).to.be.oneOf(['S', 'N'])
      cy.task('db:accountCount').then((n: any) => {
        expect(value, `derived from ${n} accounts`).to.eq(n > 1 ? 'S' : 'N')
      })
    })
  })
})
