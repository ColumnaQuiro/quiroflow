import type { BonoOwedPayment } from '../utils/bonoOwed'

// Everything the Debtors report and the dashboard's Debtors widget need to
// work out what each bono is still owed, in one request: bono_debts().
//
// Only two kinds of payment can touch a bono (see utils/bonoOwed): those
// linked to the purchase, and those on its sale invoice. The function hands
// back both -- the linked ones as their own list, the ones on a sale invoice
// embedded in the purchase under the invoice they settle -- along with the
// Stripe schedules, as the rows the three paged selects here used to return.
// What a bono is owed is still worked out from them in TypeScript; only the
// transport moved, because every page of every one of those selects was a
// request that waited its turn on the database.
//
// A sale invoice's payments are reached only through the invoice, so one this
// person cannot see brings none with it. That changes nothing: bonoOwedCents
// only counts a payment "via the invoice" when that invoice is there to be
// valid, and a bono whose invoice is hidden was already measured as having
// none.
//
// Both kinds are merged by id -- a payment can be both, and counted twice it
// would pay a bono off twice. Nothing is cut short at Supabase's 1,000-row
// cap, which applies to a select and not to what a function returns (the
// linked payments were once read unpaged, and every bono paid past row 1000
// read as unpaid; the schedules still were until this).
export interface BonoPurchaseRow {
  id: string
  patient_id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
  invoice_id: string | null
  owed_cents: number | null
  installments: number | null
  installment_cents: number | null
  external_reference: string | null
  patients: { first_name: string; last_name: string | null } | null
}
export interface BonoInvoiceRow { id: string; status: string; total_cents: number }
export interface BonoScheduleRow { package_purchase_id: string | null; status: string }

type PaymentRow = BonoOwedPayment & { id: string }

export function useBonoDebts() {
  const supabase = useSupabaseClient()
  /** `order` is the purchases' order: the report lists newest first, the widget sorts its own. */
  return async function loadBonoDebts(order: 'newest' | 'id') {
    type Row = BonoPurchaseRow & { invoices: (BonoInvoiceRow & { payments: PaymentRow[] }) | null }
    const { data, error } = await supabase.rpc('bono_debts' as never, { p_newest_first: order === 'newest' } as never)
    if (error) throw error
    const debts = (data ?? {}) as unknown as { purchases?: Row[]; linked_payments?: PaymentRow[]; schedules?: BonoScheduleRow[] }
    const rows = debts.purchases ?? []
    const linked = debts.linked_payments ?? []
    const schedules = debts.schedules ?? []

    const invoicesById = new Map<string, BonoInvoiceRow>()
    const paymentsById = new Map<string, PaymentRow>()
    for (const p of linked) paymentsById.set(p.id, p)
    for (const row of rows) {
      if (!row.invoices) continue
      const { payments, ...invoice } = row.invoices
      invoicesById.set(invoice.id, invoice)
      for (const p of payments) paymentsById.set(p.id, p)
    }
    return {
      purchases: rows.map(({ invoices: _invoice, ...purchase }) => purchase),
      invoicesById,
      schedulesByPurchase: new Map(schedules.map((s) => [s.package_purchase_id as string, s])),
      payments: [...paymentsById.values()] as BonoOwedPayment[],
    }
  }
}
