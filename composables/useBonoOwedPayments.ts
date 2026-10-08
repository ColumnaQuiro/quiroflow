import type { BonoOwedPayment } from '../utils/bonoOwed'
import { fetchAllRows } from './useFetchAllRows'

// Everything the Debtors report and the dashboard's Debtors widget need to
// work out what each bono is still owed, in three requests side by side.
//
// Only two kinds of payment can touch a bono (see utils/bonoOwed): those
// linked to the purchase, and those on its sale invoice. The linked ones are
// their own paged query. The ones on a sale invoice come embedded in the
// purchase, under the invoice they settle -- they used to be a second round
// of requests after the purchases had loaded, passing every sale invoice's id
// back in the URL, chunked, with the invoices themselves a third.
//
// Embedding reaches a sale invoice's payments only through the invoice, so
// one this person cannot see brings none with it. That changes nothing:
// bonoOwedCents only counts a payment "via the invoice" when that invoice is
// there to be valid, and a bono whose invoice is hidden was already measured
// as having none.
//
// Both kinds are merged by id -- a payment can be both, and counted twice it
// would pay a bono off twice. Everything pages, so nothing is cut short at
// Supabase's 1,000-row cap as the ledger grows (the linked payments were once
// read unpaged, and every bono paid past row 1000 read as unpaid).
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
  external_reference: string | null
  patients: { first_name: string; last_name: string | null } | null
}
export interface BonoInvoiceRow { id: string; status: string; total_cents: number }
export interface BonoScheduleRow { package_purchase_id: string | null; status: string }

const PAYMENT_COLUMNS = 'id, invoice_id, amount_cents, package_purchase_id, external_reference, purpose'
type PaymentRow = BonoOwedPayment & { id: string }

export function useBonoDebts() {
  const supabase = useSupabaseClient()
  /** `order` is the purchases' order: the report lists newest first, the widget sorts its own. */
  return async function loadBonoDebts(order: 'newest' | 'id') {
    type Row = BonoPurchaseRow & { invoices: (BonoInvoiceRow & { payments: PaymentRow[] }) | null }
    const [rows, linked, { data: schedules }] = await Promise.all([
      fetchAllRows<Row>((from, to) => {
        let query = supabase
          .from('package_purchases')
          .select(
            `id, patient_id, package_name, sessions_total, sessions_used, price_cents, purchased_at, invoice_id, owed_cents, external_reference, patients!package_purchases_patient_id_fkey(first_name, last_name), invoices!package_purchases_invoice_id_fkey(id, status, total_cents, payments!payments_invoice_id_fkey(${PAYMENT_COLUMNS}))`,
          )
        query = order === 'newest' ? query.order('purchased_at', { ascending: false }).order('id') : query.order('id')
        return query.range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>
      }),
      fetchAllRows<PaymentRow>((from, to) => supabase.from('payments').select(PAYMENT_COLUMNS).not('package_purchase_id', 'is', null).order('id').range(from, to)),
      supabase.from('payment_schedules').select('package_purchase_id, status').not('package_purchase_id', 'is', null),
    ])

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
      schedulesByPurchase: new Map((schedules ?? []).map((s) => [s.package_purchase_id as string, s as BonoScheduleRow])),
      payments: [...paymentsById.values()] as BonoOwedPayment[],
    }
  }
}
