import type { BonoOwedPayment } from '~/utils/bonoOwed'
import { fetchAllRows, fetchByIds } from '~/composables/useFetchAllRows'

// The payments bonoOwedCents can count, for every bono in the account at once
// -- what the Debtors report and the dashboard's Debtors widget both need.
//
// They used to select the whole payments table with no .range(), so Supabase
// returned the first 1000 rows in no particular order and dropped the rest.
// The live account had 3,352 payments on 23 Sep 2026: any bono whose payments
// fell past row 1000 read as unpaid, a debt already settled.
//
// Only two kinds of payment can touch a bono (see utils/bonoOwed): those
// linked to the purchase, and those on its sale invoice. Fetching just those
// is a few dozen rows rather than the whole ledger, and both queries page, so
// neither can be cut short again as the ledger grows. A payment can be both,
// so the two are merged by id -- counted twice, it would pay a bono off twice.
export function useBonoOwedPayments() {
  const supabase = useSupabaseClient()
  return async function fetchBonoOwedPayments(saleInvoiceIds: string[]): Promise<BonoOwedPayment[]> {
    type Row = BonoOwedPayment & { id: string }
    const columns = 'id, invoice_id, amount_cents, package_purchase_id, external_reference, purpose'
    const [linked, onSaleInvoices] = await Promise.all([
      fetchAllRows<Row>((from, to) => supabase.from('payments').select(columns).not('package_purchase_id', 'is', null).order('id').range(from, to)),
      fetchByIds<Row>(saleInvoiceIds, (chunk) => supabase.from('payments').select(columns).in('invoice_id', chunk)),
    ])
    const byId = new Map<string, Row>()
    for (const p of [...linked, ...onSaleInvoices]) byId.set(p.id, p)
    return [...byId.values()]
  }
}
