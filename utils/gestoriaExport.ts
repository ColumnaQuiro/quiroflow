import { exemptionClause } from './facturaTax'

// The quarter (or month) for the gestoría: the libro registro de facturas
// expedidas, the IVA summary by rate, and the money in by payment method --
// what an accountant asks for to file the 303/130 and keep the books. Pure,
// so the page's preview and the ZIP (server/utils/gestoriaExport.ts) read the
// same figures.
//
// Facturas only: a factura is the fiscal document; an internal receipt is
// not. A rectificativa is in the book with its negative amounts, so the
// totals are net of refunds. An ANNULLED factura (a registro de anulación,
// annul_factura) stays in the book -- its number is part of the series and a
// gap would need explaining -- marked "Anulada" with zero amounts, and counts
// in no total. Amounts are written the Spanish way ("1234,56")
// for Excel set to Spanish, and the CSVs use ';' (toCsv).

export interface GestoriaFactura {
  number: string
  kind: string
  issued_at: string
  description: string | null
  amount_cents: number
  tax_base_cents: number | null
  tax_rate_bp: number | null
  tax_amount_cents: number | null
  tax_exemption_code: string | null
  recipient_name: string | null
  recipient_nif: string | null
  rectifies_number: string | null
  payment_method: string | null
  /** Set when a registro de anulación was issued for it: it documents nothing. */
  annulled_at?: string | null
}

export const KIND_ES: Record<string, string> = { simplified: 'Simplificada', full: 'Completa', rectificativa: 'Rectificativa' }

/** "1234,56" (negative "-12,00"): what a Spanish Excel reads as a number. */
export function eurPlain(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

const rateLabel = (bp: number | null) => `${((bp ?? 0) / 100).toLocaleString('es-ES')} %`

export function facturaBookRows(facturas: GestoriaFactura[], timeZone: string): Record<string, string>[] {
  return [...facturas]
    .sort((a, b) => a.issued_at.localeCompare(b.issued_at) || a.number.localeCompare(b.number))
    .map((f) => ({
      'Fecha expedición': new Date(f.issued_at).toLocaleDateString('es-ES', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }),
      Número: f.number,
      Tipo: KIND_ES[f.kind] ?? f.kind,
      Estado: f.annulled_at ? 'Anulada' : '',
      'Rectifica a': f.rectifies_number ?? '',
      Destinatario: f.recipient_name ?? '',
      'NIF destinatario': f.recipient_nif ?? '',
      'Base imponible': eurPlain(f.annulled_at ? 0 : (f.tax_base_cents ?? f.amount_cents)),
      'Tipo IVA': rateLabel(f.tax_rate_bp),
      'Cuota IVA': eurPlain(f.annulled_at ? 0 : (f.tax_amount_cents ?? 0)),
      Total: eurPlain(f.annulled_at ? 0 : f.amount_cents),
      Exención: f.tax_exemption_code ? `${f.tax_exemption_code} · ${exemptionClause(f.tax_exemption_code)}` : '',
      'Forma de pago': f.payment_method ?? '',
      Concepto: f.description ?? '',
    }))
}

export interface IvaLine { key: string; label: string; count: number; baseCents: number; cuotaCents: number; totalCents: number }

/** One line per IVA rate (and one per exemption), net of rectificativas, leaving annulled facturas out. */
export function ivaSummary(facturas: GestoriaFactura[]): { lines: IvaLine[]; total: IvaLine } {
  const by = new Map<string, IvaLine>()
  for (const f of facturas) {
    if (f.annulled_at) continue
    const exempt = !!f.tax_exemption_code
    const key = exempt ? `exempt:${f.tax_exemption_code}` : `rate:${f.tax_rate_bp ?? 0}`
    const label = exempt ? `Exenta (${f.tax_exemption_code})` : `IVA ${rateLabel(f.tax_rate_bp)}`
    const line = by.get(key) ?? { key, label, count: 0, baseCents: 0, cuotaCents: 0, totalCents: 0 }
    line.count++
    line.baseCents += f.tax_base_cents ?? f.amount_cents
    line.cuotaCents += f.tax_amount_cents ?? 0
    line.totalCents += f.amount_cents
    by.set(key, line)
  }
  const lines = [...by.values()].sort((a, b) => a.key.localeCompare(b.key))
  const total = lines.reduce((t, l) => ({ ...t, count: t.count + l.count, baseCents: t.baseCents + l.baseCents, cuotaCents: t.cuotaCents + l.cuotaCents, totalCents: t.totalCents + l.totalCents }), { key: 'total', label: 'Total', count: 0, baseCents: 0, cuotaCents: 0, totalCents: 0 })
  return { lines, total }
}

export function ivaSummaryRows(facturas: GestoriaFactura[]): Record<string, string>[] {
  const { lines, total } = ivaSummary(facturas)
  return [...lines, total].map((l) => ({ Concepto: l.label, Facturas: String(l.count), 'Base imponible': eurPlain(l.baseCents), 'Cuota IVA': eurPlain(l.cuotaCents), Total: eurPlain(l.totalCents) }))
}

export interface GestoriaPayment { paid_at: string; amount_cents: number; method: string; factura_number: string | null }

/** Money in by payment method (cash and card are different books). Spending credit is not money. */
export function paymentsByMethod(payments: GestoriaPayment[]): { method: string; count: number; cents: number }[] {
  const by = new Map<string, { method: string; count: number; cents: number }>()
  for (const p of payments) {
    if (p.method === 'credit') continue
    const row = by.get(p.method) ?? { method: p.method, count: 0, cents: 0 }
    row.count++
    row.cents += p.amount_cents
    by.set(p.method, row)
  }
  return [...by.values()].sort((a, b) => b.cents - a.cents)
}

/** First and last day of quarter `q` (1-4) of `year`, as YYYY-MM-DD. */
export function quarterBounds(year: number, q: number): { from: string; to: string } {
  const startMonth = (q - 1) * 3
  const from = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`
  const last = new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10)
  return { from, to: last }
}
