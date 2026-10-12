import { stripeClientFor } from '~/server/utils/stripe'
import { patientCardLink } from '~/server/utils/patientCardLink'

// Same customer get-or-create as setup-intent.post.ts (here in
// server/utils/patientCardLink.ts, shared with online booking), but instead of a
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
    .select('stripe_connect_account_id, stripe_publishable_key')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account?.stripe_publishable_key) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured. Set it up in Settings > Payments.' })
  }

  const { data: patient } = await supabase.from('patients').select('id, first_name, last_name, email').eq('id', body.patientId).maybeSingle()
  if (!patient) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }

  const { stripe, options } = await stripeClientFor(event, teamMember.account_id, account)
  const origin = getRequestURL(event).origin
  const url = await patientCardLink(supabase, stripe, options, {
    accountId: teamMember.account_id,
    patient,
    successUrl: `${origin}/card-saved?status=success`,
    cancelUrl: `${origin}/card-saved?status=cancelled`,
  })
  return { url }
})
