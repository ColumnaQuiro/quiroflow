import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'

export interface PlatformPaymentRow {
  saleId: string
  date: string
  product: string
  transactionAmountCents: number
  taxAmountCents: number
  status: 'success' | 'failed' | 'pending'
  method: { brand: string; last4: string } | null
  invoiceUrl: string | null
}

// Read-only payment history for the in-app "Payments" tab, sourced live from
// Stripe's Invoices API on the platform billing account (QuiroFlow's own
// subscription of the clinic, NOT the per-clinic Connect account used to bill
// patients) -- no local invoice table to keep in sync, Stripe is already the
// source of truth. Zero-amount invoices (trial start, a $0 plan) are
// deliberately included, not filtered out.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireTeamMember(event)
  if (!teamMember.is_owner) {
    throw createError({ statusCode: 403, statusMessage: 'Only the account owner can view billing details' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: subscription } = await supabase.from('subscriptions').select('stripe_customer_id, plans(name)').eq('account_id', teamMember.account_id).maybeSingle()
  if (!subscription?.stripe_customer_id) {
    return { payments: [] as PlatformPaymentRow[] }
  }

  const stripe = stripeForPlatformBilling()

  // This API version moved per-invoice payment/charge details behind a
  // separate InvoicePayment sub-resource (no more Invoice.payment_intent),
  // which would mean an extra Stripe call per row to resolve. Rather than
  // pay that N+1 cost, every row shows whichever card is on the customer
  // today -- accurate for the common case (one card for the account's whole
  // lifetime) and a reasonable simplification when it isn't.
  let method: { brand: string; last4: string } | null = null
  const defaultPmResult = await stripe.customers.retrieve(subscription.stripe_customer_id, { expand: ['invoice_settings.default_payment_method'] })
  if (!defaultPmResult.deleted) {
    const defaultPm = defaultPmResult.invoice_settings?.default_payment_method
    if (defaultPm && typeof defaultPm !== 'string' && defaultPm.card) {
      method = { brand: defaultPm.card.brand, last4: defaultPm.card.last4 }
    } else {
      const methods = await stripe.paymentMethods.list({ customer: subscription.stripe_customer_id, type: 'card', limit: 1 })
      const pm = methods.data[0]
      if (pm?.card) method = { brand: pm.card.brand, last4: pm.card.last4 }
    }
  }

  const invoices = await stripe.invoices.list({ customer: subscription.stripe_customer_id, limit: 24 })

  const payments: PlatformPaymentRow[] = invoices.data.map((invoice) => {
    let status: PlatformPaymentRow['status'] = 'pending'
    if (invoice.status === 'paid') status = 'success'
    else if (invoice.status === 'void' || invoice.status === 'uncollectible') status = 'failed'

    const taxCents = (invoice.total_taxes ?? []).reduce((sum, t) => sum + t.amount, 0)

    return {
      saleId: invoice.number ?? invoice.id ?? '',
      date: new Date(invoice.created * 1000).toISOString(),
      product: invoice.lines.data[0]?.description ?? subscription.plans?.name ?? 'Subscription',
      transactionAmountCents: invoice.status === 'paid' ? invoice.amount_paid : invoice.amount_due,
      taxAmountCents: taxCents,
      status,
      method,
      invoiceUrl: invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null,
    }
  })

  return { payments }
})
