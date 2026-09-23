import { stripeClientFor } from '~/server/utils/stripe'

// The cancellation fee, as the cancel step asks for it: added to the
// patient's balance, or charged to the card on file now.
//
// It used to be written from the browser -- an invoice and a line item
// inserted client-side after a confirm() -- which could only ever do the
// first. Charging a card needs Stripe, so it happens here, and so does the
// invoice, so the two cannot disagree. The fee is read from the account, not
// taken from the request: the screen shows it, it does not set it.
//
// A charge that Stripe refuses (declined, needs authentication) is not an
// error for the caller: the invoice is already raised, unpaid, which is
// exactly "add it to the balance". The response says which happened.
// Payment, factura and invoice status are recorded by the
// payment_intent.succeeded webhook from metadata.invoice_id -- the same path
// an online-booking payment takes -- so a charge is never recorded twice.
interface Body {
  appointmentId: string
  charge: 'balance' | 'card'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body?.appointmentId || (body.charge !== 'balance' && body.charge !== 'card')) {
    throw createError({ statusCode: 400, statusMessage: 'appointmentId and charge (balance | card) are required' })
  }

  // Adding to a balance is what any staff member could already do from the
  // old status dropdown. Taking money from a card is a payment.
  const { supabase, teamMember } = body.charge === 'card' ? await requirePermission(event, 'billing_access') : await requireTeamMember(event)

  const { data: appt } = await supabase.from('appointments').select('id, patient_id, status').eq('id', body.appointmentId).maybeSingle()
  if (!appt) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  if (appt.status !== 'cancelled') throw createError({ statusCode: 409, statusMessage: 'Only a cancelled appointment carries a cancellation fee' })

  const { data: account } = await supabase.from('accounts').select('cancellation_fee_cents, stripe_connect_account_id').eq('id', teamMember.account_id).maybeSingle()
  const feeCents = account?.cancellation_fee_cents ?? 0
  if (!account || feeCents <= 0) throw createError({ statusCode: 400, statusMessage: 'No cancellation fee is configured' })

  // No number, no invoice: an unnumbered fee is worse than an uncharged one.
  const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: teamMember.account_id })
  if (!invoiceNumber) throw createError({ statusCode: 500, statusMessage: 'Could not number the invoice' })
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({ account_id: teamMember.account_id, patient_id: appt.patient_id, invoice_number: invoiceNumber, status: 'unpaid', total_cents: feeCents })
    .select('id')
    .single()
  if (invoiceError || !invoice) throw createError({ statusCode: 500, statusMessage: invoiceError?.message ?? 'Could not raise the invoice' })
  await supabase.from('invoice_line_items').insert({
    account_id: teamMember.account_id,
    invoice_id: invoice.id,
    description: 'Cancellation fee',
    quantity: 1,
    price_cents: feeCents,
  })

  if (body.charge === 'balance') return { invoiceId: invoice.id, charged: false }

  const { data: customer } = await supabase
    .from('patient_stripe_customers')
    .select('stripe_customer_id, default_payment_method_id')
    .eq('patient_id', appt.patient_id)
    .maybeSingle()
  if (!customer?.default_payment_method_id) return { invoiceId: invoice.id, charged: false, reason: 'no_card' }

  const { stripe, options } = await stripeClientFor(event, teamMember.account_id, account)
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: feeCents,
        currency: 'eur',
        customer: customer.stripe_customer_id,
        payment_method: customer.default_payment_method_id,
        off_session: true,
        confirm: true,
        description: 'Cancellation fee',
        metadata: { invoice_id: invoice.id, account_id: teamMember.account_id },
      },
      options,
    )
    return { invoiceId: invoice.id, charged: intent.status === 'succeeded' || intent.status === 'processing' }
  } catch (e) {
    return { invoiceId: invoice.id, charged: false, reason: 'declined', message: (e as Error).message }
  }
})
