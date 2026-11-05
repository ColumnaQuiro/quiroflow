import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { patientCardLink } from '~/server/utils/patientCardLink'
import { appPaymentsAccount } from '~/server/utils/appPayments'

// "Añadir tarjeta" / "Cambiar tarjeta" in the patient app: the same
// Stripe-hosted page staff send as a card link (create-card-link.post.ts),
// opened in the phone's browser, onto the same Stripe customer. The
// setup_intent.succeeded webhook makes the new card the default and lets the
// old one go, so there is still only one card behind "the card on file".
//
// Offered only where the clinic lets patients pay visits from the app.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId?: string }>(event)
  if (!body?.patientId) throw createError({ statusCode: 400, statusMessage: 'patientId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: patient } = await supabase.from('patients').select('id, account_id, first_name, last_name, email').eq('id', body.patientId).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const account = await appPaymentsAccount(service, patient.account_id)
  if (!account?.stripe_publishable_key || !account.stripe_app_payments_enabled) {
    throw createError({ statusCode: 400, statusMessage: 'Online payment is not configured for this clinic.' })
  }

  const { stripe, options } = await stripeClientFor(event, account.id, account)
  const origin = getRequestURL(event).origin
  const url = await patientCardLink(service, stripe, options, {
    accountId: account.id,
    patient,
    successUrl: `${origin}/card-saved?status=success&app=1`,
    cancelUrl: `${origin}/card-saved?status=cancelled&app=1`,
  })
  return { url }
})
