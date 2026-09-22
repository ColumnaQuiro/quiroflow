// What a line on an invoice says it is for.
//
// These are STORED, on rows that end up on a factura and, from 2027, in what
// gets transmitted to the AEAT. They are records of what was billed, not
// labels on a screen -- so they must not be built with t(), whose answer
// depends on the UI language of whoever happened to be logged in.
//
// They were. `${package_name} — ${t('session', 'sesión')}` produced
// "Bono 12 sesiones — session" on 14 Sep 2026, in English, on a Spanish
// clinic's invoice, because one person had the app in English that afternoon.
// Every other line that week says "sesión". The invoice is not wrong about
// the money, but the same event is described two ways depending on who was
// at the screen, and nothing downstream can group them.
//
// Spanish, fixed: Columnaquiro invoices in Spanish and a factura is a Spanish
// fiscal document. If QuiroFlow ever bills a clinic that works in another
// language, this is where that belongs -- per ACCOUNT, from a setting, not
// per viewer.

/** A visit drawn from a bono, as it reads on the invoice. */
export function bonoSessionDescription(packageName: string): string {
  return `${packageName} — sesión`
}

/**
 * A refund line, with the receipt it reverses.
 *
 * "Refund" was hardcoded English here while the reason beside it was typed in
 * Spanish by reception -- "Refund (INV-3480) — sesión ya cubierta por el
 * bono". Half a sentence in each language, on a rectificativa.
 */
export function refundDescription(invoiceNumber: string | null, reason: string): string {
  const trimmed = reason.trim()
  // Null is defensive rather than reachable today: every refund is against a
  // receipt, and a payment can only be refunded when it has one. It exists so
  // that changing the latter produces a description rather than
  // "Reembolso (null)", which is not a description of anything.
  if (!invoiceNumber) return trimmed ? `Reembolso — ${trimmed}` : 'Reembolso'
  return trimmed ? `Reembolso (${invoiceNumber}) — ${trimmed}` : `Reembolso — ${invoiceNumber}`
}
