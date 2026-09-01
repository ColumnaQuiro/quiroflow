import { stripeClientFor } from '~/server/utils/stripe'

// Detaches the patient's saved card from Stripe (both the embedded-form and
// card-link flows only ever attach one payment method per customer, so
// there's nothing else to preserve) and clears our own record of it.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId: string }>(event)
  if (!body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'billing_config')

  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_connect_account_id, stripe_secret_key')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured' })
  }

  const { data: customerRow } = await supabase
    .from('patient_stripe_customers')
    .select('default_payment_method_id')
    .eq('patient_id', body.patientId)
    .maybeSingle()
  if (!customerRow?.default_payment_method_id) {
    throw createError({ statusCode: 400, statusMessage: 'This patient has no saved card' })
  }

  const { stripe, options } = stripeClientFor(account)
  await stripe.paymentMethods.detach(customerRow.default_payment_method_id, {}, options)

  await supabase.from('patient_stripe_customers').update({ default_payment_method_id: null }).eq('patient_id', body.patientId)

  return { success: true }
})
