import { stripeClientFor } from '~/server/utils/stripe'

// Which card is on file -- brand, last four, expiry.
//
// The app stored only the payment-method id, so every screen could say
// "Card on file" and none could say WHICH card. That is the thing a front
// desk needs when a payment fails or a patient says they have changed
// bank: "the Visa ending 4242" is how the conversation goes, and an id
// beginning pm_ is not.
//
// Read live rather than stored, deliberately. A card's expiry moves when
// the issuer reissues it and Stripe updates the PaymentMethod in place; a
// copy in our database would quietly become wrong, and a wrong last-four is
// worse than none because someone will act on it.
//
// Gated on billing_config, the same permission that lets you add, replace
// or remove the card. Anyone who can change which card is on file can see
// which one it is; everyone else keeps the plain "Card on file".
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId: string }>(event)
  if (!body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'billing_config')

  const { data: customerRow } = await supabase
    .from('patient_stripe_customers')
    .select('default_payment_method_id')
    .eq('patient_id', body.patientId)
    .maybeSingle()
  // No card is not an error -- it is the common case, and the caller renders
  // a different sentence for it.
  if (!customerRow?.default_payment_method_id) return { card: null }

  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_connect_account_id')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account) return { card: null }

  const { stripe, options } = await stripeClientFor(event, teamMember.account_id, account)

  try {
    const method = await stripe.paymentMethods.retrieve(customerRow.default_payment_method_id, undefined, options)
    if (!method.card) return { card: null }
    return {
      card: {
        brand: method.card.brand,
        last4: method.card.last4,
        expMonth: method.card.exp_month,
        expYear: method.card.exp_year,
      },
    }
  } catch {
    // A detached or deleted payment method still leaves its id on our row.
    // The screen falls back to "Card on file" rather than breaking the tab
    // over a detail.
    return { card: null }
  }
})
