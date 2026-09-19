import { buildRegistroAlta, type RegistroAltaInput } from '../../../utils/registroAlta'
import {
  MAX_RECORDS_PER_SUBMISSION,
  VERIFACTU_ENDPOINTS,
  buildRegFactuEnvelope,
  parseVerifactuResponse,
  verifactuEndpoint,
} from '../../../utils/verifactuSoap'

// The envelope out and the answer back.
//
// Nothing here connects to the AEAT -- no certificate exists yet. These are
// the two documents either side of the wire, which are worth getting right
// first because the transport between them is small and mostly credentials.
describe('Talking to the AEAT', () => {
  const registro = (serie: string) =>
    buildRegistroAlta({
      record: {
        issuerNif: 'B16365504',
        serieNumber: serie,
        issuedOn: '2026-09-18',
        invoiceType: 'F2',
        cuotaTotalCents: 0,
        importeTotalCents: 5500,
        generatedAt: '2026-09-18T15:27:28+02:00',
        previousHuella: null,
        huella: 'D295E0DBD018B6C552DB81F02DD785250DF76665D075DE668ACB6E7D153BDA93',
      },
      previousRecord: null,
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
    } as RegistroAltaInput)

  it('sends each kind of certificate to its own host', () => {
    // The WSDL exposes SistemaVerifactu and SistemaVerifactuSello on separate
    // hosts, and the AEAT will not accept a certificate at the wrong one --
    // it fails at the TLS handshake, which reads as a connection error and
    // says nothing about certificates.
    //
    // Columnaquiro's certificate is a representante (issuer "AC
    // Representación"), so today's traffic goes to the plain host.
    expect(verifactuEndpoint('test', 'representative')).to.contain('prewww1.aeat.es')
    expect(verifactuEndpoint('production', 'representative')).to.contain('www1.agenciatributaria.gob.es')
    expect(verifactuEndpoint('test', 'seal')).to.contain('prewww10.aeat.es')
    expect(verifactuEndpoint('production', 'seal')).to.contain('www10.agenciatributaria.gob.es')
    expect(verifactuEndpoint('production', 'seal')).to.eq(VERIFACTU_ENDPOINTS.productionSello)
  })

  it('names the clinic as obligado, not us', () => {
    // Cabecera identifies whose facturación this is. We are the sender,
    // identified by the certificate on the connection. Putting QuiroFlow here
    // would file every clinic's invoices under our NIF.
    const xml = buildRegFactuEnvelope({
      obligado: { nif: 'B16365504', nombreRazon: 'Columnaquiro S.L' },
      registros: [registro('F-2026-0052')],
    })
    expect(xml).to.contain('<sum1:NIF>B16365504</sum1:NIF>')
    expect(xml).to.contain('<sum1:NombreRazon>Columnaquiro S.L</sum1:NombreRazon>')
    expect(xml).to.contain('<sum:RegFactuSistemaFacturacion>')
    expect(xml).to.contain('<sum:RegistroFactura>')
    expect(xml).to.contain('<sum1:RegistroAlta>')
  })

  it('refuses to send nothing, or more than the AEAT accepts', () => {
    expect(MAX_RECORDS_PER_SUBMISSION).to.eq(1000)
    expect(() => buildRegFactuEnvelope({ obligado: { nif: 'B1', nombreRazon: 'X' }, registros: [] })).to.throw(
      'nothing to send',
    )
    // 1001 is rejected wholesale by the AEAT, taking a thousand good records
    // with it. Better to fail while batching.
    const many = Array.from({ length: 1001 }, (_, i) => registro(`F-${i}`))
    expect(() => buildRegFactuEnvelope({ obligado: { nif: 'B1', nombreRazon: 'X' }, registros: many })).to.throw(
      'exceeds the AEAT limit',
    )
  })

  it('reads a wholly accepted answer, and the pace the AEAT sets', () => {
    const xml = `<?xml version="1.0"?>
      <env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
      <env:Body><tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="x" xmlns:tik="y">
        <tik:CSV>A-CSV-FROM-AEAT</tik:CSV>
        <tik:Cabecera><tik:ObligadoEmision><tik:NIF>B16365504</tik:NIF></tik:ObligadoEmision></tik:Cabecera>
        <tik:TiempoEsperaEnvio>60</tik:TiempoEsperaEnvio>
        <tikR:EstadoEnvio>Correcto</tikR:EstadoEnvio>
        <tikR:RespuestaLinea>
          <tik:IDFactura><tik:NumSerieFactura>F-2026-0052</tik:NumSerieFactura></tik:IDFactura>
          <tikR:EstadoRegistro>Correcto</tikR:EstadoRegistro>
        </tikR:RespuestaLinea>
      </tikR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`

    const r = parseVerifactuResponse(xml)
    expect(r.estadoEnvio).to.eq('Correcto')
    expect(r.csv).to.eq('A-CSV-FROM-AEAT')
    // AEAT dictates the pace between submissions; a sender that ignores it
    // gets throttled, so this is parsed rather than left in the XML.
    expect(r.waitSeconds).to.eq(60)
    expect(r.lines).to.have.length(1)
    expect(r.lines[0].serieNumber).to.eq('F-2026-0052')
    expect(r.lines[0].estado).to.eq('Correcto')
    expect(r.lines[0].errorCode).to.eq(null)
  })

  it('separates the three verdicts in a partially accepted answer', () => {
    const xml = `<Respuesta>
        <TiempoEsperaEnvio>120</TiempoEsperaEnvio>
        <EstadoEnvio>ParcialmenteCorrecto</EstadoEnvio>
        <RespuestaLinea>
          <IDFactura><NumSerieFactura>F-1</NumSerieFactura></IDFactura>
          <EstadoRegistro>Correcto</EstadoRegistro>
        </RespuestaLinea>
        <RespuestaLinea>
          <IDFactura><NumSerieFactura>F-2</NumSerieFactura></IDFactura>
          <EstadoRegistro>AceptadoConErrores</EstadoRegistro>
          <CodigoErrorRegistro>2004</CodigoErrorRegistro>
          <DescripcionErrorRegistro>Valor no permitido en un campo no determinante</DescripcionErrorRegistro>
        </RespuestaLinea>
        <RespuestaLinea>
          <IDFactura><NumSerieFactura>F-3</NumSerieFactura></IDFactura>
          <EstadoRegistro>Incorrecto</EstadoRegistro>
          <CodigoErrorRegistro>1100</CodigoErrorRegistro>
          <DescripcionErrorRegistro>Valor o tipo incorrecto del campo</DescripcionErrorRegistro>
        </RespuestaLinea>
      </Respuesta>`

    const r = parseVerifactuResponse(xml)
    expect(r.estadoEnvio).to.eq('ParcialmenteCorrecto')
    expect(r.waitSeconds).to.eq(120)
    expect(r.lines.map((l) => l.estado)).to.deep.eq(['Correcto', 'AceptadoConErrores', 'Incorrecto'])

    // The verdicts are carried through unchanged. What they MEAN for
    // resending is the schema's rule and the sender's job, not the parser's --
    // stating it in two places is how the two come to disagree.
    expect(r.lines[1].errorCode).to.eq('2004')
    expect(r.lines[2].errorCode).to.eq('1100')
    expect(r.lines[2].errorMessage).to.eq('Valor o tipo incorrecto del campo')
  })

  it('notices a duplicate, which is not the same as an error', () => {
    const xml = `<R><EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
      <RespuestaLinea>
        <IDFactura><NumSerieFactura>F-9</NumSerieFactura></IDFactura>
        <EstadoRegistro>Correcto</EstadoRegistro>
        <RegistroDuplicado><EstadoRegistroDuplicado>Correcta</EstadoRegistroDuplicado></RegistroDuplicado>
      </RespuestaLinea></R>`
    const r = parseVerifactuResponse(xml)
    expect(r.lines[0].duplicated).to.be.true
    expect(r.lines[0].estado).to.eq('Correcto')
  })

  it('does not care which prefixes the AEAT happens to use', () => {
    // Matching on sf:/sfR: would work until the live service prefixed
    // differently, and the failure would read as "the AEAT accepted nothing"
    // rather than as a parsing bug.
    const a = parseVerifactuResponse('<x><EstadoEnvio>Correcto</EstadoEnvio></x>')
    const b = parseVerifactuResponse('<x><whatever:EstadoEnvio>Correcto</whatever:EstadoEnvio></x>')
    expect(a.estadoEnvio).to.eq('Correcto')
    expect(b.estadoEnvio).to.eq(a.estadoEnvio)
  })

  it('returns nulls rather than guesses when a field is absent', () => {
    // A response missing EstadoEnvio must not read as accepted. Nothing here
    // defaults to success.
    const r = parseVerifactuResponse('<x></x>')
    expect(r.estadoEnvio).to.eq(null)
    expect(r.csv).to.eq(null)
    expect(r.waitSeconds).to.eq(null)
    expect(r.lines).to.deep.eq([])
  })
})
