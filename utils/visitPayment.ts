// How a visit was paid for.
//
// The appointment row has to say this, and the answer is not on the
// appointment: it is spread across four tables, and which one holds it
// depends on how the clinic took the money.
//
//   package_sessions   the visit drew down a bono
//   invoices           the visit was charged
//   payments           the charge was settled, and by what method
//   facturas           the settlement produced a fiscal document
//
// The order matters. A bono-drawn visit is checked first because it is the
// case that looks like "nothing happened" -- no invoice, no payment, no
// document -- while in fact the money changed hands when the pack was
// bought. Reading only the invoice tables would render every bono visit as
// unpaid, which is precisely the reading the ledger had to stop making.
//
// Pure, and exported on its own, so the rules can be tested without a
// browser or a seeded database -- the same reason utils/billing.ts is
// separate from the screens that print money.

export interface VisitPaymentInput {
  /** A package_sessions row for this appointment, if the visit drew on a bono. */
  session?: { amount_cents: number; external_reference: string | null } | null
  /** The package_purchases row that session belongs to. */
  purchase?: { package_name: string; sessions_total: number; sessions_used: number; external_reference: string | null } | null
  /** An invoices row for this appointment, if it was charged. */
  invoice?: { invoice_number: string; total_cents: number; status: string } | null
  /** payments settling that invoice. */
  payments?: { method: string; amount_cents: number }[]
  /** factura numbers issued against those payments. */
  facturaNumbers?: string[]
}

export type VisitPayment =
  | { kind: 'bono'; packageName: string; remaining: number; total: number; reference: string | null }
  | { kind: 'settled'; methods: string[]; facturaNumber: string | null; invoiceNumber: string }
  | { kind: 'unpaid'; invoiceNumber: string; totalCents: number }
  | { kind: 'void'; invoiceNumber: string }
  | { kind: 'none' }

export function resolveVisitPayment(input: VisitPaymentInput): VisitPayment {
  // A drawn bono session is the whole answer, even when an invoice also
  // exists: the invoice in that case is the bono's own sale, not a charge
  // for this visit, and showing its number here would invite someone to
  // chase a payment that was taken months ago.
  if (input.session) {
    const purchase = input.purchase
    return {
      kind: 'bono',
      packageName: purchase?.package_name ?? 'Bono',
      remaining: purchase ? Math.max(0, purchase.sessions_total - purchase.sessions_used) : 0,
      total: purchase?.sessions_total ?? 0,
      // The clinic's own reference for the pack, when the import carried
      // one -- staff quote it, PracticeHub printed it.
      reference: input.session.external_reference ?? purchase?.external_reference ?? null,
    }
  }

  const invoice = input.invoice
  if (!invoice) return { kind: 'none' }

  // A voided charge is not an unpaid one, and saying "unpaid" of it would
  // put the visit on a debtors list it was deliberately taken off.
  if (invoice.status === 'void') return { kind: 'void', invoiceNumber: invoice.invoice_number }

  const payments = input.payments ?? []
  if (payments.length === 0) {
    return { kind: 'unpaid', invoiceNumber: invoice.invoice_number, totalCents: invoice.total_cents }
  }

  // Distinct methods, in the order they were taken: a split payment is one
  // visit settled two ways and the row should say so rather than pick one.
  const methods: string[] = []
  for (const p of payments) if (!methods.includes(p.method)) methods.push(p.method)

  return {
    kind: 'settled',
    methods,
    // At most one number is shown. A split settled by two payments can
    // produce two facturas; the row names the first and the Money tab
    // carries the full picture, because a row cannot hold both and stay a
    // row.
    facturaNumber: input.facturaNumbers?.[0] ?? null,
    invoiceNumber: invoice.invoice_number,
  }
}
