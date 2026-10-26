import { describe, it, expect } from 'vitest'
import { buildRegistroAnulacion } from '../../utils/registroAlta'
import { parseVerifactuResponse, sendableBeforeAnulacionWait } from '../../utils/verifactuSoap'
import { facturaBookRows, ivaSummary, type GestoriaFactura } from '../../utils/gestoriaExport'

// Annulling a factura issued in error: the VERI*FACTU registro de anulación,
// how the sender treats it, and what the books say about the factura after.
describe('A factura annulled with a registro de anulación', () => {
  const record = {
    issuerNif: 'B12345678',
    serieNumber: 'F-2027-0007',
    issuedOn: '2027-01-04',
    generatedAt: '2027-01-05T09:30:00Z',
    previousHuella: 'ABC123',
    huella: 'DEF456',
  }

  describe('the XML', () => {
    const xml = buildRegistroAnulacion({
      record,
      previousRecord: { issuerNif: 'B12345678', serieNumber: 'F-2027-0008', issuedOn: '2027-01-05' },
      accountId: 'acc-1',
      indicadorMultiplesOt: 'S',
    })
    const at = (tag: string) => xml.indexOf(`<sum1:${tag}>`)

    it('names the annulled factura with the "Anulada" fields the AEAT expects', () => {
      expect(xml).to.contain('<sum1:IDEmisorFacturaAnulada>B12345678</sum1:IDEmisorFacturaAnulada>')
      expect(xml).to.contain('<sum1:NumSerieFacturaAnulada>F-2027-0007</sum1:NumSerieFacturaAnulada>')
      expect(xml).to.contain('<sum1:FechaExpedicionFacturaAnulada>04-01-2027</sum1:FechaExpedicionFacturaAnulada>')
      expect(xml.startsWith('<sum1:RegistroAnulacion>')).to.eq(true)
    })

    it('follows the schema order: IDVersion, IDFactura, Encadenamiento, SistemaInformatico, timestamp, huella', () => {
      // The record's own Huella is the LAST one: the first sits inside RegistroAnterior.
      const order = [...['IDVersion', 'IDFactura', 'Encadenamiento', 'SistemaInformatico', 'FechaHoraHusoGenRegistro', 'TipoHuella'].map(at), xml.lastIndexOf('<sum1:Huella>')]
      expect(order.every((i) => i >= 0)).to.eq(true)
      expect([...order].sort((a, b) => a - b)).to.deep.eq(order)
    })

    it('chains to its predecessor in full, with the huella it was hashed from', () => {
      expect(xml).to.contain('<sum1:RegistroAnterior><sum1:IDEmisorFactura>B12345678</sum1:IDEmisorFactura><sum1:NumSerieFactura>F-2027-0008</sum1:NumSerieFactura><sum1:FechaExpedicionFactura>05-01-2027</sum1:FechaExpedicionFactura><sum1:Huella>ABC123</sum1:Huella></sum1:RegistroAnterior>')
    })

    it('carries the timestamp exactly as it was hashed: Madrid time, whole seconds', () => {
      expect(xml).to.contain('<sum1:FechaHoraHusoGenRegistro>2027-01-05T10:30:00+01:00</sum1:FechaHoraHusoGenRegistro>')
    })

    it('has none of an alta’s fields: no type, no amounts, no recipient', () => {
      for (const tag of ['TipoFactura', 'ImporteTotal', 'CuotaTotal', 'Destinatarios', 'Desglose', 'NombreRazonEmisor']) expect(at(tag), tag).to.eq(-1)
    })

    it('goes as PrimerRegistro when it is the first record of its chain', () => {
      const first = buildRegistroAnulacion({ record, previousRecord: null, accountId: 'acc-1', indicadorMultiplesOt: 'S' })
      expect(first).to.contain('<sum1:PrimerRegistro>S</sum1:PrimerRegistro>')
      expect(first).not.to.contain('RegistroAnterior')
    })
  })

  describe('the AEAT’s answer', () => {
    it('is told apart from the alta’s answer for the same factura by its operation', () => {
      const xml = `<RespuestaRegFactuSistemaFacturacion><EstadoEnvio>Correcto</EstadoEnvio>
        <RespuestaLinea><IDFactura><NumSerieFactura>F-2027-0007</NumSerieFactura></IDFactura><Operacion><TipoOperacion>Alta</TipoOperacion></Operacion><EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>
        <RespuestaLinea><IDFactura><NumSerieFactura>F-2027-0007</NumSerieFactura></IDFactura><Operacion><TipoOperacion>Anulacion</TipoOperacion></Operacion><EstadoRegistro>Incorrecto</EstadoRegistro><CodigoErrorRegistro>3002</CodigoErrorRegistro></RespuestaLinea>
      </RespuestaRegFactuSistemaFacturacion>`
      const lines = parseVerifactuResponse(xml).lines
      expect(lines.map((l) => [l.serieNumber, l.operation, l.estado])).to.deep.eq([
        ['F-2027-0007', 'Alta', 'Correcto'],
        ['F-2027-0007', 'Anulacion', 'Incorrecto'],
      ])
    })
  })

  describe('when the sender lets it go', () => {
    const r = (id: string, recordType: 'alta' | 'anulacion', facturaId: string) => ({ id, recordType, facturaId })

    it('sends it once the AEAT holds the alta it annuls', () => {
      const pending = [r('1', 'alta', 'fB'), r('2', 'anulacion', 'fA'), r('3', 'alta', 'fC')]
      expect(sendableBeforeAnulacionWait(pending, new Set(['fB', 'fC'])).map((p) => p.id)).to.deep.eq(['1', '2', '3'])
    })

    it('holds it, and everything after it, while its alta is still owed', () => {
      // Same envelope as its own alta, or behind a refused one: either way the
      // AEAT would be asked to annul a record it does not have.
      const pending = [r('1', 'alta', 'fA'), r('2', 'anulacion', 'fA'), r('3', 'alta', 'fC')]
      expect(sendableBeforeAnulacionWait(pending, new Set(['fA', 'fC'])).map((p) => p.id)).to.deep.eq(['1'])
    })
  })

  describe('in the books', () => {
    const f = (over: Partial<GestoriaFactura>): GestoriaFactura => ({
      number: 'F-2027-0001',
      kind: 'simplified',
      issued_at: '2027-01-04T10:00:00Z',
      description: 'Consulta',
      amount_cents: 4500,
      tax_base_cents: 4500,
      tax_rate_bp: 0,
      tax_amount_cents: 0,
      tax_exemption_code: 'E1',
      recipient_name: null,
      recipient_nif: null,
      rectifies_number: null,
      payment_method: 'Tarjeta',
      ...over,
    })

    it('counts in no total', () => {
      const { total } = ivaSummary([f({}), f({ number: 'F-2027-0002', annulled_at: '2027-01-05T09:30:00Z' })])
      expect(total.count).to.eq(1)
      expect(total.totalCents).to.eq(4500)
    })

    it('stays in the libro registro, marked annulled with zero amounts, so the series has no gap', () => {
      const rows = facturaBookRows([f({ annulled_at: '2027-01-05T09:30:00Z' })], 'Europe/Madrid')
      expect(rows).to.have.length(1)
      expect(rows[0].Estado).to.eq('Anulada')
      expect(rows[0].Total).to.eq('0,00')
      expect(rows[0]['Base imponible']).to.eq('0,00')
    })
  })
})
