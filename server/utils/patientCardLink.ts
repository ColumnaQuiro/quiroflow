import type Stripe from 'stripe'

// A Stripe-hosted page where a patient saves a card to their own Stripe
// customer on the clinic's account: a Checkout session in setup mode. Staff
// send it as "Card link" (api/stripe/create-card-link.post.ts); online booking
// sends the patient there straight after booking when the clinic asks for a
// card (api/public-booking/book.post.ts). The setup_intent.succeeded webhook
// records the card as theirs either way (stripeWebhookHandlers.ts).
export async function patientCardLink(
  supabase: any,
  stripe: Stripe,
  options: Stripe.RequestOptions,
  args: { accountId: string; patient: { id: string; first_name: string; last_name: string | null; email: string | null }; successUrl: string; cancelUrl: string },
): Promise<string> {
  const { data: existing } = await supabase.from('patient_stripe_customers').select('stripe_customer_id').eq('patient_id', args.patient.id).maybeSingle()
  let customerId = existing?.stripe_customer_id as string | undefined
  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        name: `${args.patient.first_name} ${args.patient.last_name ?? ''}`.trim(),
        email: args.patient.email ?? undefined,
        metadata: { patient_id: args.patient.id, account_id: args.accountId },
      },
      options,
    )
    customerId = customer.id
    await supabase.from('patient_stripe_customers').insert({ account_id: args.accountId, patient_id: args.patient.id, stripe_customer_id: customerId })
  }
  const session = await stripe.checkout.sessions.create(
    { mode: 'setup', customer: customerId, payment_method_types: ['card'], success_url: args.successUrl, cancel_url: args.cancelUrl },
    options,
  )
  if (!session.url) throw createError({ statusCode: 502, statusMessage: 'Stripe did not return a checkout link' })
  return session.url
}
