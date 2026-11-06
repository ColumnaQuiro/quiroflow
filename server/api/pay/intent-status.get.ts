import { timingSafeEqual } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { throttlePublic } from '~/server/utils/publicRateLimit'

// What actually happened to a payment the bank asked to authenticate, for
// /payment-done to say so. A saved-card payment from the app that needs 3-D
// Secure goes to the bank's page and comes back to the return_url
// server/utils/appPayments.ts sets -- whether the patient passed the check or
// failed it. Stripe appends only the PaymentIntent and its client secret, not
// the outcome, so the page used to say "Pago recibido" either way.
//
// No session: the return page opens in the phone's browser. The client
// secret Stripe appended is the credential, as Stripe.js treats it -- only
// someone holding it learns the status, and only the status.
export default defineEventHandler(async (event) => {
  await throttlePublic(event, { scope: 'pay-intent-status', limit: 30, windowSeconds: 600 })
  const q = getQuery(event)
  const accountId = typeof q.account === 'string' ? q.account : ''
  const intentId = typeof q.payment_intent === 'string' ? q.payment_intent : ''
  const secret = typeof q.payment_intent_client_secret === 'string' ? q.payment_intent_client_secret : ''
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !/^pi_\w+$/.test(intentId) || !secret) {
    throw createError({ statusCode: 400, statusMessage: 'account, payment_intent and payment_intent_client_secret are required' })
  }

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await service.from('accounts').select('id, stripe_connect_account_id').eq('id', accountId).maybeSingle()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Payment not found' })

  const { stripe, options } = await stripeClientFor(event, account.id, account)
  let intent
  try {
    intent = await stripe.paymentIntents.retrieve(intentId, undefined, options)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Payment not found' })
  }
  const expected = Buffer.from(intent.client_secret ?? '')
  const given = Buffer.from(secret)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw createError({ statusCode: 404, statusMessage: 'Payment not found' })
  }

  if (intent.status === 'succeeded') return { status: 'paid' as const }
  if (intent.status === 'processing') return { status: 'processing' as const }
  return { status: 'failed' as const }
})
