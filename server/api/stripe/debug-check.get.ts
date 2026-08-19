import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

// Temporary diagnostic route -- delete after use. Queries Stripe directly
// for a subscription's invoices to separate "did Stripe actually charge"
// from "did our webhook get delivered."
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) throw createError({ statusCode: 403, statusMessage: 'Not signed in' })

  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_connect_account_id, stripe_secret_key')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account) throw createError({ statusCode: 400, statusMessage: 'no account' })

  const query = getQuery(event)
  const subscriptionId = String(query.subscriptionId ?? '')
  const { stripe, options } = stripeClientFor(account)

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, options)
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, limit: 5 }, options)

    return {
      subscriptionStatus: subscription.status,
      latestInvoiceId: subscription.latest_invoice,
      invoices: invoices.data.map((inv) => ({
        id: inv.id,
        status: inv.status,
        amount_paid: inv.amount_paid,
        amount_due: inv.amount_due,
        payment_intent: typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id,
        created: inv.created,
      })),
    }
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: err?.message ?? 'Stripe lookup failed' })
  }
})
