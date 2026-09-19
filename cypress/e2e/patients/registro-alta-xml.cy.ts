import { aeatDate, buildRegistroAlta, type RegistroAltaInput } from '../../../utils/registroAlta'

// The XML the AEAT will actually read.
//
// Nothing transmits yet -- that needs the certificate and the producer's NIF.
// What can be checked now is the part that is expensive to get wrong later:
// a field that should not be there, or should be and is not, is rejected once
// per factura after transmission starts.
//
// Field names, lengths and code lists are AEAT's own (DsRegistroVeriFactu.xlsx
// and Descripción SWeb 1.0.3).
describe('The RegistroAlta the AEAT will read', () => {
  const base: RegistroAltaInput = {
    record: {
      issuerNif: 'B16365504',
      serieNumber: 'F-2026-0052',
      issuedOn: '2026-09-18',
      invoiceType: 'F2',
      cuotaTotalCents: 0,
      importeTotalCents: 5500,
      generatedAt: '2026-09-18T15:27:28+02:00',
      previousHuella: 'D62358D3300B84028C138EA48A25AF72A0CDA9F916DE324FA904828B89F4D91B',
      huella: 'D295E0DBD018B6C552DB81F02DD785250DF76665D075DE668ACB6E7D153BDA93',
    },
    previousRecord: { issuerNif: 'B16365504', serieNumber: 'F-2026-0051', issuedOn: '2026-09-17' },
    factura: {
      description: 'Ajuste Quiropractico',
      taxBaseCents: 5500,
      taxRateBp: 0,
      taxAmountCents: 0,
      taxExemptionCode: 'E1',
      recipientName: null,
      recipientNif: null,
    },
    issuerName: 'Columnaquiro S.L',
    accountId: 'ff112316-8768-4e5a-a495-b5025cefb6f2',
    indicadorMultiplesOt: 'S',
  }

  it('writes dates the way the AEAT wants them, not the way we store them', () => {
    // dd-mm-yyyy. Everything internal is ISO, and sending ISO would be
    // accepted by nothing.
    expect(aeatDate('2026-09-18')).to.eq('18-09-2026')
    expect(aeatDate('2026-01-02T10:00:00+01:00')).to.eq('02-01-2026')
  })

  it('carries OperacionExenta and NOT CalificacionOperacion when exempt', () => {
    // The record design marks these two as alternatives ("campo de selección
    // (alternativo)"): exactly one belongs in a line. The clinic's treatment
    // is exempt under article 20, so every record it has produced takes this
    // branch -- and sending both would be rejected.
    const xml = buildRegistroAlta(base)
    expect(xml).to.contain('<sum1:OperacionExenta>E1</sum1:OperacionExenta>')
    expect(xml).to.not.contain('CalificacionOperacion')
    expect(xml).to.not.contain('TipoImpositivo')
    expect(xml).to.contain('<sum1:BaseImponibleOimporteNoSujeto>55.00</sum1:BaseImponibleOimporteNoSujeto>')
  })

  it('carries CalificacionOperacion and NOT OperacionExenta when taxed', () => {
    const xml = buildRegistroAlta({
      ...base,
      factura: { ...base.factura, taxExemptionCode: null, taxRateBp: 2100, taxBaseCents: 4545, taxAmountCents: 955 },
    })
    expect(xml).to.contain('<sum1:CalificacionOperacion>S1</sum1:CalificacionOperacion>')
    expect(xml).to.not.contain('OperacionExenta')
    expect(xml).to.contain('<sum1:TipoImpositivo>21.00</sum1:TipoImpositivo>')
    expect(xml).to.contain('<sum1:CuotaRepercutida>9.55</sum1:CuotaRepercutida>')
  })

  it('leaves the customer off a simplificada and names them on a full invoice', () => {
    // Not identifying the customer is what makes F2 an F2. Putting a
    // Destinatarios block on one contradicts the type in the same document.
    expect(buildRegistroAlta(base)).to.not.contain('Destinatarios')

    const full = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: 'Paciente Ejemplo', recipientNif: '12345678Z' },
    })
    expect(full).to.contain('<sum1:Destinatarios>')
    expect(full).to.contain('<sum1:NombreRazon>Paciente Ejemplo</sum1:NombreRazon>')
    expect(full).to.contain('<sum1:NIF>12345678Z</sum1:NIF>')
  })

  it('names the whole predecessor, not only its huella', () => {
    const xml = buildRegistroAlta(base)
    expect(xml).to.contain('<sum1:RegistroAnterior>')
    expect(xml).to.contain('<sum1:NumSerieFactura>F-2026-0051</sum1:NumSerieFactura>')
    expect(xml).to.contain('<sum1:FechaExpedicionFactura>17-09-2026</sum1:FechaExpedicionFactura>')
    expect(xml).to.contain(`<sum1:Huella>${base.record.previousHuella}</sum1:Huella>`)
    expect(xml).to.not.contain('PrimerRegistro')
  })

  it('says so when it is the first record in the chain', () => {
    const xml = buildRegistroAlta({ ...base, previousRecord: null, record: { ...base.record, previousHuella: null } })
    expect(xml).to.contain('<sum1:PrimerRegistro>S</sum1:PrimerRegistro>')
    expect(xml).to.not.contain('RegistroAnterior')
  })

  it('flags a resend after rejection, and does not flag an ordinary one', () => {
    // A record the AEAT rejected was never registered there, so it goes back
    // as an ordinary alta -- with RechazoPrevio so the resend reads as
    // deliberate rather than as a duplicate.
    expect(buildRegistroAlta(base)).to.not.contain('RechazoPrevio')
    expect(buildRegistroAlta({ ...base, afterRejection: true })).to.contain(
      '<sum1:RechazoPrevio>S</sum1:RechazoPrevio>',
    )
  })

  it('sends no Signature, because transmitting is what replaces it', () => {
    // "Obligatorio para conservación y para requerimiento, pero no para
    // remisión voluntaria «VERI*FACTU»". The same sentence is why this system
    // has no XAdES signing and no registro de eventos.
    expect(buildRegistroAlta(base)).to.not.contain('Signature')
  })

  it('identifies the software on every record', () => {
    const xml = buildRegistroAlta(base)
    expect(xml).to.contain('<sum1:IdSistemaInformatico>QF</sum1:IdSistemaInformatico>')
    expect(xml).to.contain('<sum1:TipoUsoPosibleSoloVerifactu>S</sum1:TipoUsoPosibleSoloVerifactu>')
    expect(xml).to.contain('<sum1:IndicadorMultiplesOT>S</sum1:IndicadorMultiplesOT>')
    expect(xml).to.contain('<sum1:TipoHuella>01</sum1:TipoHuella>')
    expect(xml).to.contain(`<sum1:Huella>${base.record.huella}</sum1:Huella>`)
    // NumeroInstalacion is per-account, so two clinics are never the same
    // installation.
    expect(xml).to.contain(`<sum1:NumeroInstalacion>qf-${base.accountId}</sum1:NumeroInstalacion>`)
  })

  it('escapes what a patient typed, so a name cannot break the document', () => {
    const xml = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: 'Ferretería "Paco" & Hijos <SL>', recipientNif: '12345678Z' },
    })
    expect(xml).to.contain('Ferreter&iacute;a'.replace('&iacute;', 'í')) // accents pass through
    expect(xml).to.contain('&quot;Paco&quot;')
    expect(xml).to.contain('&amp; Hijos')
    expect(xml).to.contain('&lt;SL&gt;')
    expect(xml).to.not.contain('<SL>')
  })

  it('trims an over-long description rather than having the record rejected', () => {
    // The huella is computed from the total and the number, not this text, so
    // trimming changes nothing that is checked -- while sending 600 characters
    // into a 500-character field fails the whole record.
    const xml = buildRegistroAlta({ ...base, factura: { ...base.factura, description: 'x'.repeat(600) } })
    const match = /<sum1:DescripcionOperacion>(.*?)<\/sum1:DescripcionOperacion>/.exec(xml)
    expect(match).to.not.eq(null)
    expect(match![1].length).to.eq(500)
  })
})
