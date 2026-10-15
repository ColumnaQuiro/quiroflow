// Products sold over the counter (services_products.kind = 'product'): their
// stock state and margin, read the same way on Settings > Products & stock,
// the patient's "Sell product", My Day and the Monday summary.

/** The IVA rates a product can be sold at (the database allows these only). */
export const PRODUCT_TAX_RATES = [21, 10, 4] as const

export type StockStatus = 'untracked' | 'out' | 'low' | 'ok'

/** null stock = not counted (made to order). Low = at or under the minimum. */
export function stockStatus(stockUnits: number | null, minStock: number | null): StockStatus {
  if (stockUnits === null) return 'untracked'
  if (stockUnits <= 0) return 'out'
  if (minStock !== null && stockUnits <= minStock) return 'low'
  return 'ok'
}

/**
 * The margin on one unit, as a share of its price before IVA: prices are
 * what the patient pays, IVA included, and the IVA is not the clinic's. Null
 * when there is no cost to compare with.
 */
export function productMarginPct(priceCents: number, taxRatePct: number, costCents: number | null): number | null {
  if (costCents === null || priceCents <= 0) return null
  const net = priceCents / (1 + taxRatePct / 100)
  return Math.round(((net - costCents) / net) * 100)
}
