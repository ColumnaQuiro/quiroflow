import { describe, it, expect } from 'vitest'
import { aeatDate, aeatDateTime, buildRegistroAlta, type RegistroAltaInput } from '../../utils/registroAlta'

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

  it('sends the timestamp the huella was computed from, not the one Postgres stores', () => {
    // The AEAT recomputes the huella from the XML, so this field has to be
    // byte-identical to what factura_huella_input() hashed: Spanish local
    // time, whole seconds, offset spelled out.
    //
    // These two strings are the same instant, and only the first was hashed:
    //   hashed   2026-09-18T09:09:39+02:00
    //   postgres 2026-09-18 07:09:39.571153+00
    //
    // Sending the second would have been rejected on every record, with an
    // error about the huella rather than about the date.
    expect(aeatDateTime('2026-09-18T07:09:39.571153+00:00')).to.eq('2026-09-18T09:09:39+02:00')

    // Winter is +01:00. Read from the zone rather than assumed, so the clocks
    // changing does not quietly start producing rejected records.
    expect(aeatDateTime('2026-01-15T07:09:39.000000+00:00')).to.eq('2026-01-15T08:09:39+01:00')

    // Microseconds never survive into the document.
    const xml = buildRegistroAlta({
      ...base,
      record: { ...base.record, generatedAt: '2026-09-18T07:09:39.571153+00:00' },
    })
    expect(xml).to.contain('<sum1:FechaHoraHusoGenRegistro>2026-09-18T09:09:39+02:00</sum1:FechaHoraHusoGenRegistro>')
    expect(xml).to.not.contain('571153')
  })

  it('carries OperacionExenta and NOT CalificacionOperacion when exempt', () => {
    // The record design marks these two as alternatives ("campo de selección
    // (alternativo)"): exactly one belongs in a line. The clinic's treatment
    // is exempt under article 20, so every record it has produced takes this
    // branch -- and sending both would be rejected.
    const xml = buildRegistroAlta(base)
    // ClaveRegimen first, and before the exemption -- the AEAT rejected the
    // first real submission without it (error 1245), and validates the order.
    expect(xml).to.contain('<sum1:ClaveRegimen>01</sum1:ClaveRegimen>')
    expect(xml.indexOf('ClaveRegimen')).to.be.lessThan(xml.indexOf('OperacionExenta'))
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
    expect(xml).to.contain('<sum1:ClaveRegimen>01</sum1:ClaveRegimen>')
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

  it('falls back to the patient when the factura has no frozen recipient', () => {
    // Every F1 and R1 this clinic has issued carries recipient_name NULL --
    // the name resolves from the patient at render time so a NIF collected
    // next week appears on a document issued today. Sending the empty string
    // instead was refused on all 21 of them:
    //
    //   1100  Valor o tipo incorrecto del campo.: NombreRazon
    // With an identifier alongside it -- see the next test for why the name
    // alone is not enough.
    const xml = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: null, patientName: 'Ana Ruiz', patientNif: '12345678Z' },
    })
    expect(xml).to.contain('<sum1:NombreRazon>Ana Ruiz</sum1:NombreRazon>')

    // A frozen recipient still wins -- it is the one that was delivered.
    const frozen = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: 'Quien Sea', recipientNif: '99999999R', patientName: 'Ana Ruiz' },
    })
    expect(frozen).to.contain('<sum1:NombreRazon>Quien Sea</sum1:NombreRazon>')
    expect(frozen).to.contain('<sum1:NIF>99999999R</sum1:NIF>')

    // With neither, the block is omitted rather than sent empty: an absent
    // Destinatarios is a different (and answerable) complaint from a present
    // one containing nothing.
    const neither = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: null, patientName: null, patientNif: null },
    })
    expect(neither).to.not.contain('Destinatarios')
  })

  it('needs an identifier as well as a name, or sends no destinatario at all', () => {
    // IDDestinatario is NombreRazon AND (NIF or IDOtro). A name on its own is
    // refused by the schema, as a SOAP Fault rather than a per-record verdict:
    //
    //   Codigo[4102]. El XML no cumple el esquema.
    //   Falta informar campo obligatorio.: NIF
    //
    // A fault rejects the whole envelope, so one unidentifiable recipient
    // takes every other record in the batch down with it. That is why the
    // block is all-or-nothing.
    const named = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: null, patientName: 'Ana Ruiz', patientNif: null },
    })
    expect(named, 'a name with no identifier is not a destinatario').to.not.contain('Destinatarios')

    // The NIF resolves from the patient, like the name: a factura freezes its
    // recipient only once delivered, and before that both live on the patient.
    const fromPatient = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: null, recipientNif: null, patientName: 'Ana Ruiz', patientNif: '12345678Z' },
    })
    expect(fromPatient).to.contain('<sum1:NombreRazon>Ana Ruiz</sum1:NombreRazon>')
    expect(fromPatient).to.contain('<sum1:NIF>12345678Z</sum1:NIF>')
  })

  it('sends a stand-in destinatario when it is not talking to production', () => {
    // "Test environment" and "test data" were not the same thing: environment
    // picks the endpoint and nothing else, so the document was built
    // identically either way and 53 real patients were named to the AEAT's
    // preproduction service, on invoices from a clinic.
    const real = { ...base.factura, recipientName: 'Ana Ruiz', recipientNif: '12345678Z' }

    const test = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: real,
      anonymiseRecipient: true,
    })
    expect(test).to.contain('<sum1:NombreRazon>Destinatario de pruebas</sum1:NombreRazon>')
    expect(test).to.not.contain('Ana Ruiz')
    expect(test).to.not.contain('12345678Z')

    // The obligado's own NIF, and it is the third thing tried here. An
    // invented NIF (00000000T) was refused on format; IDOtro with IDType 07
    // was refused too, because the ID under it must ALSO be NIF-shaped:
    //
    //   1239  El campo ID no contiene un NIF con formato correcto. ID:PRUEBAS
    //
    // The issuer's is the only NIF that is real, passes both format and the
    // census, and belongs to nobody who needs protecting.
    expect(test).to.contain(`<sum1:NIF>${base.record.issuerNif}</sum1:NIF>`)
    expect(test, 'NIF and IDOtro are a choice, never both').to.not.contain('IDOtro')

    // A patient with nothing on file is still identified in test, rather than
    // losing the Destinatarios block -- which is what the real-data rule does,
    // and would mean the F1 path went untested for exactly those records.
    const noDataOnFile = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: { ...base.factura, recipientName: null, recipientNif: null, patientName: null, patientNif: null },
      anonymiseRecipient: true,
    })
    expect(noDataOnFile).to.contain('<sum1:Destinatarios>')
    expect(noDataOnFile).to.contain(`<sum1:NIF>${base.record.issuerNif}</sum1:NIF>`)

    // The stand-in follows the record's own issuer rather than a value written
    // down once, so a second clinic identifies itself rather than this one.
    const otherClinic = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1', issuerNif: 'B99999999' },
      factura: real,
      anonymiseRecipient: true,
    })
    // Scoped to the Destinatarios block on purpose: the original issuer's NIF
    // legitimately remains elsewhere in the document -- RegistroAnterior names
    // the predecessor's issuer, and SistemaInformatico names the software's
    // producer. Asserting its absence from the whole record fails on both.
    const destinatariosOf = (xml: string) => xml.match(/<sum1:Destinatarios>[\s\S]*?<\/sum1:Destinatarios>/)?.[0] ?? ''
    expect(destinatariosOf(otherClinic)).to.contain('<sum1:NIF>B99999999</sum1:NIF>')
    expect(destinatariosOf(otherClinic)).to.not.contain(base.record.issuerNif)

    // A simplificada names nobody in either environment: substituting a
    // recipient onto an F2 would contradict the type.
    const simplificada = buildRegistroAlta({ ...base, factura: real, anonymiseRecipient: true })
    expect(simplificada).to.not.contain('Destinatarios')

    // And production is untouched -- the real recipient, as before.
    const prod = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'F1' },
      factura: real,
    })
    expect(prod).to.contain('<sum1:NombreRazon>Ana Ruiz</sum1:NombreRazon>')
    expect(prod).to.contain('<sum1:NIF>12345678Z</sum1:NIF>')
    expect(prod).to.not.contain('Destinatario de pruebas')
  })

  it('says how a rectificativa corrects, and which factura it corrects', () => {
    // Without TipoRectificativa the AEAT refuses the record outright:
    //
    //   1114  Si la factura es de tipo rectificativa, el campo
    //         TipoRectificativa debe tener valor.
    //
    // All five rectificativas this clinic has issued were rejected for it.
    const rect = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'R1', serieNumber: 'R-2026-0001', importeTotalCents: -5500 },
      factura: { ...base.factura, taxBaseCents: -5500 },
      rectifies: { issuerNif: 'B16365504', serieNumber: 'F-2026-0006', issuedOn: '2026-09-15' },
    })

    // "I", por diferencias, because issueRectificativa() produces a NEGATIVE
    // document carrying what goes back. "S" would say the corrected factura's
    // new total is minus the refund, which is a different and false claim --
    // and would oblige ImporteRectificacion, the totals being substituted.
    expect(rect).to.contain('<sum1:TipoRectificativa>I</sum1:TipoRectificativa>')
    expect(rect, 'nothing is substituted').to.not.contain('ImporteRectificacion')

    // The corrected invoice named the way the AEAT identifies one: emisor,
    // serie and date, the same triple as Encadenamiento.
    expect(rect).to.contain('<sum1:FacturasRectificadas>')
    expect(rect).to.contain('<sum1:NumSerieFactura>F-2026-0006</sum1:NumSerieFactura>')
    expect(rect).to.contain('<sum1:FechaExpedicionFactura>15-09-2026</sum1:FechaExpedicionFactura>')

    // Order is checked by the schema, not by a validation: TipoRectificativa
    // and FacturasRectificadas sit between TipoFactura and
    // DescripcionOperacion, and out of order the whole envelope fails.
    const at = (tag: string) => rect.indexOf(`<sum1:${tag}>`)
    expect(at('TipoFactura')).to.be.lessThan(at('TipoRectificativa'))
    expect(at('TipoRectificativa')).to.be.lessThan(at('FacturasRectificadas'))
    expect(at('FacturasRectificadas')).to.be.lessThan(at('DescripcionOperacion'))

    // A refund that could not be traced to a single factura still goes, with
    // the type and without the back-reference -- a rectificativa the AEAT
    // holds beats one it refuses.
    const untraced = buildRegistroAlta({
      ...base,
      record: { ...base.record, invoiceType: 'R1' },
      rectifies: null,
    })
    expect(untraced).to.contain('<sum1:TipoRectificativa>I</sum1:TipoRectificativa>')
    expect(untraced).to.not.contain('FacturasRectificadas')

    // None of it appears on an ordinary factura.
    const ordinary = buildRegistroAlta({ ...base, record: { ...base.record, invoiceType: 'F1' } })
    expect(ordinary).to.not.contain('TipoRectificativa')
    expect(ordinary).to.not.contain('FacturasRectificadas')
  })

  it('leaves the huella input untouched when it substitutes the destinatario', () => {
    // The recipient is the one field that can be replaced without weakening
    // the test, and this is why: factura_huella_input() is IDEmisorFactura,
    // NumSerieFactura, FechaExpedicionFactura, TipoFactura, CuotaTotal,
    // ImporteTotal, the previous Huella and the timestamp. None of it is the
    // destinatario, so the chain the AEAT re-walks is identical either way.
    const args = { ...base, record: { ...base.record, invoiceType: 'F1' as const }, factura: { ...base.factura, recipientName: 'Ana Ruiz', recipientNif: '12345678Z' } }
    const strip = (xml: string) => xml.replace(/<sum1:Destinatarios>[\s\S]*?<\/sum1:Destinatarios>/, '')
    expect(strip(buildRegistroAlta({ ...args, anonymiseRecipient: true }))).to.eq(strip(buildRegistroAlta(args)))
  })

  it('sends a subsanación with both flags, and an ordinary alta with neither', () => {
    // Both flags, never one. The AEAT refuses RechazoPrevio without
    // Subsanacion (1161), and every retry was rejected for it.
    const amending = buildRegistroAlta({ ...base, subsanacion: true })
    expect(amending).to.contain('<sum1:Subsanacion>S</sum1:Subsanacion>')
    expect(amending).to.contain('<sum1:RechazoPrevio>S</sum1:RechazoPrevio>')

    expect(buildRegistroAlta(base)).to.not.contain('Subsanacion')
    expect(buildRegistroAlta(base)).to.not.contain('RechazoPrevio')
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
