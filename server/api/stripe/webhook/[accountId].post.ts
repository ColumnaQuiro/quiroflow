import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForAccount } from '~/server/utils/stripe'
import type Stripe from 'stripe'

// One webhook URL per account (the accountId is embedded in the path) since
// each clinic connects its own Stripe account with its own signing secret --
// unlike Meta, Stripe gives us no shared identifier to resolve the account
// from the payload alone. Stripe handles the actual charging (Subscription
// Schedules); this just mirrors the outcome into payment_schedules /
// stripe_payment_events so the app's reports stay in sync.
export default defineEventHandler(async (event) => {
  const accountId = getRouterParam(event, 'accountId')
  if (!accountId) throw createError({ statusCode: 400, statusMessage: 'Missing account id' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await supabase
    .from('accounts')
    .select('id, stripe_secret_key, stripe_webhook_secret')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.stripe_secret_key || !account?.stripe_webhook_secret) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured for this account' })
  }

  const signature = getHeader(event, 'stripe-signature')
  const rawBody = await readRawBody(event)
  if (!signature || !rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Missing signature or body' })
  }

  const stripe = stripeForAccount(account.stripe_secret_key)
  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, account.stripe_webhook_secret)
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: `Invalid signature: ${err?.message}` })
  }

  async function findSchedule(subscriptionId: string | null) {
    if (!subscriptionId) return null
    const { data } = await supabase
      .from('payment_schedules')
      .select('id, installments_paid, installments_total, package_purchase_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle()
    return data
  }

  if (stripeEvent.type === 'invoice.paid' || stripeEvent.type === 'invoice.payment_failed') {
    const invoice = stripeEvent.data.object as Stripe.Invoice
    const subscriptionId = typeof (invoice as any).subscription === 'string' ? (invoice as any).subscription : null
    const schedule = await findSchedule(subscriptionId)
    if (schedule) {
      const status = stripeEvent.type === 'invoice.paid' ? 'paid' : 'failed'
      await supabase.from('stripe_payment_events').insert({
        account_id: account.id,
        payment_schedule_id: schedule.id,
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: typeof (invoice as any).payment_intent === 'string' ? (invoice as any).payment_intent : null,
        amount_cents: invoice.amount_paid || invoice.amount_due,
        status,
        period_start: new Date((invoice.period_start ?? Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10),
      })

      if (status === 'paid') {
        const installmentsPaid = schedule.installments_paid + 1
        const completed = schedule.installments_total != null && installmentsPaid >= schedule.installments_total
        await supabase
          .from('payment_schedules')
          .update({ installments_paid: installmentsPaid, status: completed ? 'completed' : 'active' })
          .eq('id', schedule.id)
      } else {
        await supabase.from('payment_schedules').update({ status: 'past_due' }).eq('id', schedule.id)
      }
    }
  }

  // Subscription Schedule create response only sometimes carries the
  // subscription id up front (e.g. when start_date is deferred to skip an
  // already-paid installment); this backfills it once Stripe activates it.
  if (stripeEvent.type === 'subscription_schedule.updated' || stripeEvent.type === 'subscription_schedule.released') {
    const schedule = stripeEvent.data.object as Stripe.SubscriptionSchedule
    const subscriptionId = typeof schedule.subscription === 'string' ? schedule.subscription : null
    if (subscriptionId) {
      await supabase
        .from('payment_schedules')
        .update({ stripe_subscription_id: subscriptionId })
        .eq('stripe_subscription_schedule_id', schedule.id)
        .is('stripe_subscription_id', null)
    }
  }

  if (stripeEvent.type === 'subscription_schedule.canceled') {
    const schedule = stripeEvent.data.object as Stripe.SubscriptionSchedule
    await supabase.from('payment_schedules').update({ status: 'canceled' }).eq('stripe_subscription_schedule_id', schedule.id)
  }

  return { received: true }
})
