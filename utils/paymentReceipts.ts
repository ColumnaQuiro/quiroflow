// Which payment rows are money arriving, and which only say where money that
// already arrived ended up.
//
// `payments` carries both and they are indistinguishable at a glance: same
// table, same amount_cents, same paid_at. Two of the methods are not receipts.
//
// 'credit' spends a patient's account balance. Those euros were received
// earlier and recorded then, as their own payment with the real method --
// cash, card -- and purpose 'on_account'. Counting the credit row as well
// counts the same money twice: Alonso Varela handed over 115 EUR in cash on
// 16 Sep 2026, it was applied to his bono an hour later, and September read
// 230 EUR for it. The same figure also appeared under a payment method called
// "credit", beside Efectivo and Tarjeta, which is how it was noticed -- the
// cash he paid with had turned into a method of its own.
//
// 'write_off' settles an invoice with no money at all. Counting it reports a
// debt forgiven as a debt collected.
//
// Both still SETTLE invoices, so anything asking "is this invoice paid" or
// "how much is outstanding" must go on counting them. This is about takings
// only. utils/bonoOwed skips 'on_account' for the mirror-image reason: there,
// the receipt is the row that must not count twice.
export const NON_RECEIPT_METHODS: readonly string[] = ['credit', 'write_off']

/** True when this payment is money that came in, rather than money moved. */
export function isReceipt(method: string): boolean {
  return !NON_RECEIPT_METHODS.includes(method)
}
