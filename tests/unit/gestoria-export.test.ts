import { describe, expect, it } from 'vitest'
import { eurPlain, facturaBookRows, ivaSummary, paymentsByMethod, quarterBounds, type GestoriaFactura } from '../../utils/gestoriaExport'

// The gestoría's quarter (utils/gestoriaExport.ts).
const f = (over: Partial<GestoriaFactura>): GestoriaFactura => ({
  number: 'F-2026-0001', kind: 'simplified', issued_at: '2026-10-05T09:00:00Z', description: 'Consulta', amount_cents: 4500,
  tax_base_cents: 4500, tax_rate_bp: 0, tax_amount_cents: 0, tax_exemption_code: 'E1', recipient_name: null, recipient_nif: null,
  rectifies_number: null, payment_method: 'card', ...over,
})

describe('gestoría export', () => {
  it('writes amounts the Spanish way', () => {
    expect(eurPlain(123456)).toBe('1234,56')
    expect(eurPlain(-1200)).toBe('-12,00')
    expect(eurPlain(5)).toBe('0,05')
  })

  it('sums IVA by rate and exemption, net of rectificativas', () => {
    const facturas = [
      f({}),
      f({ number: 'F-2026-0002', amount_cents: 3630, tax_base_cents: 3000, tax_rate_bp: 2100, tax_amount_cents: 630, tax_exemption_code: null }),
      f({ number: 'R-2026-0001', kind: 'rectificativa', amount_cents: -3630, tax_base_cents: -3000, tax_rate_bp: 2100, tax_amount_cents: -630, tax_exemption_code: null, rectifies_number: 'F-2026-0002' }),
      f({ number: 'F-2026-0003', amount_cents: 1100, tax_base_cents: 1000, tax_rate_bp: 1000, tax_amount_cents: 100, tax_exemption_code: null }),
    ]
    const { lines, total } = ivaSummary(facturas)
    expect(lines.map((l) => [l.label, l.count, l.baseCents, l.cuotaCents])).toEqual([
      ['Exenta (E1)', 1, 4500, 0],
      ['IVA 10 %', 1, 1000, 100],
      ['IVA 21 %', 2, 0, 0],
    ])
    expect(total).toMatchObject({ count: 4, baseCents: 5500, cuotaCents: 100, totalCents: 5600 })
  })

  it('lists the book in date order with what each one rectifies', () => {
    const rows = facturaBookRows([f({ number: 'F-2', issued_at: '2026-10-06T09:00:00Z' }), f({ number: 'R-1', kind: 'rectificativa', issued_at: '2026-10-07T09:00:00Z', rectifies_number: 'F-2', amount_cents: -4500, tax_base_cents: -4500 }), f({ number: 'F-1' })], 'Europe/Madrid')
    expect(rows.map((r) => r['Número'])).toEqual(['F-1', 'F-2', 'R-1'])
    expect(rows[2]).toMatchObject({ Tipo: 'Rectificativa', 'Rectifica a': 'F-2', Total: '-45,00', 'Fecha expedición': '07/10/2026' })
    expect(rows[0]!['Exención']).toContain('E1')
  })

  it('counts money in by method, leaving spent credit out', () => {
    expect(paymentsByMethod([
      { paid_at: '', amount_cents: 4500, method: 'card', factura_number: null },
      { paid_at: '', amount_cents: 2000, method: 'cash', factura_number: null },
      { paid_at: '', amount_cents: 4500, method: 'card', factura_number: null },
      { paid_at: '', amount_cents: 4500, method: 'credit', factura_number: null },
    ])).toEqual([{ method: 'card', count: 2, cents: 9000 }, { method: 'cash', count: 1, cents: 2000 }])
  })

  it('knows the quarters', () => {
    expect(quarterBounds(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(quarterBounds(2026, 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
  })
})
