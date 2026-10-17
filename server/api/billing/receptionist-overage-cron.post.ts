import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { stripeForPlatformBilling } from '~/server/utils/platformBillingStripe'
import {
  RECEPTIONIST_BLOCK_PRICE_CENTS,
  RECEPTIONIST_INCLUDED_REPLIES,
  monthNameEs,
  previousMonthStart,
  receptionistExtraBlocks,
} from '~/utils/receptionistAllowance'

// Charges last month's receptionist replies past the allowance: 1,000 are
// included, each further 1,000 or part of one is EUR 15 + IVA
// (utils/receptionistAllowance.ts). Called by a pg_cron job hourly on the 1st
// (the later runs retry a charge cut off half way, and otherwise find every
// month already charged and do nothing); like
// every *-cron endpoint, that job is created by hand against production
// (CLAUDE.md, "Scheduling a cron"), and the deploy fails until it exists.
//
// Its own invoice, issued now, rather than a line left pending for the next
// subscription invoice: on an annual plan that is up to a year away, and a
// clinic should be charged for October in November, not next September. The
// invoice is created first and the line attached to it, never "include
// pending items" -- that would sweep a plan change's prorations, which
// belong on the subscription's own invoice, into this one.
//
// Not charged: a comped account, one still in its trial (the trial includes
// everything), and one with no Stripe customer to charge. Their replies are
// counted all the same.
//
// The body may name a month ({ month: 'YYYY-MM' }) to re-run one, behind the
// same cron secret. A month already charged is skipped whatever the body says.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = (await readBody<{ month?: unknown }>(event).catch(() => null)) ?? {}
  const month = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month)
    ? `${body.month}-01`
    : previousMonthStart(clinicDateOf(new Date(), DEFAULT_CLINIC_TIMEZONE))

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: counts, error: countError } = await supabase.rpc('receptionist_replies_in_month', { p_month: month })
  if (countError) throw createError({ statusCode: 500, statusMessage: countError.message })

  const over = (counts ?? []).filter((c) => c.replies > RECEPTIONIST_INCLUDED_REPLIES)
  if (over.length === 0) return { month, charged: [] as string[], skipped: [] as string[] }

  const { data: subscriptions, error: subError } = await supabase
    .from('subscriptions')
    .select('account_id, status, comped, stripe_customer_id')
    .in('account_id', over.map((c) => c.account_id))
  if (subError) throw createError({ statusCode: 500, statusMessage: subError.message })
  const subscriptionOf = new Map((subscriptions ?? []).map((s) => [s.account_id, s]))

  // Refuse rather than invoice without VAT in live mode, as subscribe does: a
  // Spanish B2B invoice with no IVA is wrong on both sets of books.
  const taxRateId = runtimeConfig.stripePlatformBillingTaxRateId || null
  if (!taxRateId && runtimeConfig.stripePlatformBillingSecretKey.startsWith('sk_live_')) {
    throw createError({ statusCode: 500, statusMessage: 'No VAT rate is configured for billing (NUXT_STRIPE_PLATFORM_BILLING_TAX_RATE_ID).' })
  }
  // Made on the first charge, not before: a month with nobody to charge
  // must not need Stripe configured to say so.
  let stripe: Awaited<ReturnType<typeof stripeForPlatformBilling>> | null = null
  const name = monthNameEs(month)

  const charged: string[] = []
  const skipped: string[] = []
  for (const { account_id: accountId, replies } of over) {
    const subscription = subscriptionOf.get(accountId)
    if (!subscription || subscription.comped || subscription.status === 'trialing' || !subscription.stripe_customer_id) {
      skipped.push(accountId)
      continue
    }

    const blocks = receptionistExtraBlocks(replies)
    const amountCents = blocks * RECEPTIONIST_BLOCK_PRICE_CENTS

    // Claimed before Stripe is called, so the row is what makes it happen once.
    // A claim with an invoice is done. One without is a charge cut off half
    // way: retried while Stripe still honours the idempotency keys (24 hours
    // -- the job runs hourly through the 1st), so the retry can only finish
    // the same invoice, never start a second. Past that it is left for a
    // person, loudly, rather than risk billing twice.
    const { data: existing } = await supabase
      .from('receptionist_overage_charges')
      .select('stripe_invoice_id, created_at')
      .eq('account_id', accountId)
      .eq('month', month)
      .maybeSingle()
    if (existing?.stripe_invoice_id) {
      skipped.push(accountId)
      continue
    }
    if (existing && Date.now() - new Date(existing.created_at).getTime() > 23 * 3600 * 1000) {
      console.error(`[receptionist-overage] ${accountId} ${month} was claimed over a day ago and never invoiced: check Stripe before charging it by hand`)
      skipped.push(accountId)
      continue
    }
    if (!existing) {
      const { error: claimError } = await supabase
        .from('receptionist_overage_charges')
        .insert({ account_id: accountId, month, replies, blocks, amount_cents: amountCents })
      // A duplicate here is another call claiming it at the same moment; it
      // charges, this one does not.
      if (claimError) {
        if (claimError.code !== '23505') console.error(`[receptionist-overage] could not claim ${accountId} ${month}:`, claimError.message)
        skipped.push(accountId)
        continue
      }
    }

    const line = `Recepcionista IA: ${blocks} ${blocks === 1 ? 'bloque' : 'bloques'} de 1.000 respuestas por encima de las ${RECEPTIONIST_INCLUDED_REPLIES.toLocaleString('es-ES')} incluidas (${name}, ${replies.toLocaleString('es-ES')} respuestas)`
    try {
      stripe ??= await stripeForPlatformBilling()
      const invoice = await stripe.invoices.create(
        {
          customer: subscription.stripe_customer_id,
          collection_method: 'charge_automatically',
          auto_advance: true,
          pending_invoice_items_behavior: 'exclude',
          ...(taxRateId ? { default_tax_rates: [taxRateId] } : {}),
          description: `Recepcionista IA · ${name}`,
          metadata: { account_id: accountId, receptionist_overage_month: month },
        },
        { idempotencyKey: `receptionist-overage-invoice-${accountId}-${month}` },
      )
      await stripe.invoiceItems.create(
        { customer: subscription.stripe_customer_id, invoice: invoice.id, currency: 'eur', amount: amountCents, description: line },
        { idempotencyKey: `receptionist-overage-item-${accountId}-${month}` },
      )
      // A retry finds the invoice already finalised; finalising twice is an error.
      if (invoice.status === 'draft') await stripe.invoices.finalizeInvoice(invoice.id!, { auto_advance: true })
      await supabase.from('receptionist_overage_charges').update({ stripe_invoice_id: invoice.id }).eq('account_id', accountId).eq('month', month)
      charged.push(accountId)
    } catch (err) {
      // The claim stays without an invoice id; the next hourly run retries it
      // with the same idempotency keys.
      console.error(`[receptionist-overage] could not invoice ${accountId} for ${month}:`, (err as Error)?.message ?? err)
      skipped.push(accountId)
    }
  }

  return { month, charged, skipped }
})
