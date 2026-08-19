import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

// Creates (or reuses) a Stripe Customer for a patient, then a SetupIntent so
// the browser can collect a card via Stripe Elements without card data ever
// touching our server.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const body = await readBody<{ patientId: string }>(event)
  if (!body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId is required' })
  }

  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

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

  const { data: existing } = await supabase
    .from('patient_stripe_customers')
    .select('stripe_customer_id')
    .eq('patient_id', body.patientId)
    .maybeSingle()

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

  const setupIntent = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ['card'] }, options)

  return {
    clientSecret: setupIntent.client_secret,
    publishableKey: account.stripe_publishable_key,
    connectAccountId: account.stripe_connect_account_id,
    customerId,
  }
})
