import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

// Called after the browser confirms a SetupIntent with Stripe Elements --
// makes the newly-attached card the customer's default so future
// subscription schedules auto-charge it.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const body = await readBody<{ patientId: string; paymentMethodId: string }>(event)
  if (!body?.patientId || !body?.paymentMethodId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId and paymentMethodId are required' })
  }

  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

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
    .select('stripe_customer_id')
    .eq('patient_id', body.patientId)
    .maybeSingle()
  if (!customerRow) {
    throw createError({ statusCode: 400, statusMessage: 'No Stripe customer on file for this patient yet' })
  }

  const { stripe, options } = stripeClientFor(account)
  await stripe.customers.update(customerRow.stripe_customer_id, { invoice_settings: { default_payment_method: body.paymentMethodId } }, options)

  await supabase
    .from('patient_stripe_customers')
    .update({ default_payment_method_id: body.paymentMethodId })
    .eq('patient_id', body.patientId)

  return { success: true }
})
