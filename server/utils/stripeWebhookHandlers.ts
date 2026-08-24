import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import type Stripe from 'stripe'

// Shared by both webhook routes: the legacy per-account endpoint
// (webhook/[accountId].post.ts) and the platform-level Connect endpoint
// (webhook.post.ts). Mirrors Stripe's outcome into payment_schedules /
// stripe_payment_events so the app's reports stay in sync -- Stripe does
// the actual charging (Subscription Schedules) on its own.
export async function handleStripeEvent(supabase: SupabaseClient<Database>, accountId: string, stripeEvent: Stripe.Event) {
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
        account_id: accountId,
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

  // Online booking deposit/full-payment (create-payment-intent.post.ts sets
  // metadata.invoice_id on creation). This is the source of truth for
  // reconciliation -- the booking itself already exists regardless of
  // payment outcome, so a delayed or missed webhook only leaves the invoice
  // temporarily unpaid, never an orphaned charge or a lost appointment.
  if (stripeEvent.type === 'payment_intent.succeeded') {
    const intent = stripeEvent.data.object as Stripe.PaymentIntent
    const invoiceId = intent.metadata?.invoice_id
    if (invoiceId) {
      const { data: existingPayment } = await supabase
        .from('payments')
        .select('id')
        .eq('stripe_payment_intent_id', intent.id)
        .maybeSingle()
      if (!existingPayment) {
        await supabase.from('payments').insert({
          account_id: accountId,
          invoice_id: invoiceId,
          amount_cents: intent.amount_received,
          method: 'card',
          stripe_payment_intent_id: intent.id,
        })

        const { data: invoice } = await supabase.from('invoices').select('total_cents').eq('id', invoiceId).maybeSingle()
        if (invoice) {
          const { data: payments } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId)
          const paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
          if (paidCents >= invoice.total_cents) {
            await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId)
          }
        }
      }
    }
  }
}
