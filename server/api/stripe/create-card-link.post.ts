import { stripeClientFor } from '~/server/utils/stripe'

// Same customer get-or-create as setup-intent.post.ts, but instead of a
// SetupIntent for our own embedded Stripe Elements form, this creates a
// Stripe Checkout Session in `setup` mode -- a fully Stripe-hosted page
// staff can copy a link to and send the patient however they like (WhatsApp,
// email, SMS), so the patient can enter their own card without staff ever
// seeing it. The resulting payment method attaches to the same Stripe
// customer either way, so "Add card" and this link are interchangeable.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId: string }>(event)
  if (!body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'billing_config')

  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_connect_account_id, stripe_secret_key, stripe_publishable_key')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.stripe_publishable_key) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured. Set it up in Settings > Payments.' })
  }

  const { data: patient } = await supabase.from('patients').select('id, first_name, last_name, email').eq('id', body.patientId).maybeSingle()
  if (!patient) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }

  const { stripe, options } = stripeClientFor(account)

  const { data: existing } = await supabase.from('patient_stripe_customers').select('stripe_customer_id').eq('patient_id', body.patientId).maybeSingle()

  let customerId = existing?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        name: `${patient.first_name} ${patient.last_name}`,
        email: patient.email ?? undefined,
        metadata: { patient_id: patient.id, account_id: teamMember.account_id },
      },
      options,
    )
    customerId = customer.id
    await supabase.from('patient_stripe_customers').insert({
      account_id: teamMember.account_id,
      patient_id: patient.id,
      stripe_customer_id: customerId,
    })
  }

  const origin = getRequestURL(event).origin
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['card'],
      success_url: `${origin}/card-saved?status=success`,
      cancel_url: `${origin}/card-saved?status=cancelled`,
    },
    options,
  )
  if (!session.url) {
    throw createError({ statusCode: 502, statusMessage: 'Stripe did not return a checkout link' })
  }

  return { url: session.url }
})
