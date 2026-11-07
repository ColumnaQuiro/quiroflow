/**
 * A one-line receipt -- and, with a payment method, the payment that settles
 * it -- written by raise_invoice() in one transaction: all of it or none of
 * it. See 20261107121939_raise_invoice_whole_or_not_at_all.sql for what the
 * separate inserts it replaces left behind when one of them failed.
 *
 * The factura is not part of it: for a real payment (not 'credit') the
 * caller issues it once, for the `paymentId` returned, through
 * useFacturas().issueFactura.
 */
export interface RaisedInvoice {
  invoiceId: string
  invoiceNumber: string
  /** Set when a payment method was given. */
  paymentId: string | null
}

export interface RaiseInvoiceInput {
  patientId: string
  description: string
  amountCents: number
  appointmentId?: string | null
  /** Omit for an unpaid receipt (a fee added to the balance). */
  paymentMethod?: string | null
}

/** Never throws: the error comes back as text, and nothing was written when it does. */
export async function raiseInvoice(supabase: any, input: RaiseInvoiceInput): Promise<{ invoice: RaisedInvoice | null; error: string | null }> {
  const { data, error } = await supabase.rpc('raise_invoice', {
    p_patient_id: input.patientId,
    p_description: input.description,
    p_amount_cents: input.amountCents,
    p_appointment_id: input.appointmentId ?? null,
    p_payment_method: input.paymentMethod ?? null,
  })
  const row = data as { invoice_id?: string; invoice_number?: string; payment_id?: string | null } | null
  if (error || !row?.invoice_id || !row.invoice_number) return { invoice: null, error: error?.message ?? 'The receipt could not be raised' }
  return { invoice: { invoiceId: row.invoice_id, invoiceNumber: row.invoice_number, paymentId: row.payment_id ?? null }, error: null }
}
