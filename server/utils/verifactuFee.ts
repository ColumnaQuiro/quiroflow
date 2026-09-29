import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { findVerifactuFeeItem, verifactuFeeItemChange, type SubscriptionItemChange } from '~/utils/verifactuFee'
import { retrieveChangeableSubscription, stripeForPlatformBilling } from './platformBillingStripe'

// The VeriFactu fee on the platform subscription -- see utils/verifactuFee.ts
// for the item decision and 20260928184512_verifactu_fee.sql for what is due.

export interface VerifactuFeePrices {
  priceId: string | null
  allPriceIds: Set<string>
}

/** The fee's Stripe prices out of `addons`, like growthAddonPrices. */
export async function verifactuFeePrices(
  serviceRole: SupabaseClient<Database>,
  interval: 'monthly' | 'annual',
): Promise<VerifactuFeePrices> {
  const { data: addon } = await serviceRole
    .from('addons')
    .select('stripe_monthly_price_id, stripe_annual_price_id')
    .eq('id', 'verifactu')
    .maybeSingle()
  const monthly = addon?.stripe_monthly_price_id ?? null
  const annual = addon?.stripe_annual_price_id ?? null
  return {
    priceId: interval === 'annual' ? annual : monthly,
    allPriceIds: new Set([monthly, annual].filter((id): id is string => !!id)),
  }
}

/** How many locations are due now for this account (0 unless live and started). */
export async function verifactuFeeLocations(serviceRole: SupabaseClient<Database>, accountId: string): Promise<number> {
  const { data } = await serviceRole.rpc('verifactu_fee_locations', { p_account_id: accountId })
  return Number(data ?? 0)
}

/**
 * The fee's item for subscribe/preview, rebuilt for the interval being
 * changed TO. Carried across a plan change even though the owner never
 * touches it: Stripe refuses a subscription whose items bill on different
 * intervals.
 */
export async function verifactuFeeItemFor(
  serviceRole: SupabaseClient<Database>,
  accountId: string,
  interval: 'monthly' | 'annual',
  currentItems: { id: string; price: { id: string }; quantity?: number | null }[],
): Promise<SubscriptionItemChange | null> {
  const [prices, locations] = await Promise.all([verifactuFeePrices(serviceRole, interval), verifactuFeeLocations(serviceRole, accountId)])
  const existing = findVerifactuFeeItem(
    currentItems.map((i) => ({ id: i.id, priceId: i.price.id, quantity: i.quantity ?? 0 })),
    prices.allPriceIds,
  )
  return verifactuFeeItemChange(existing, prices.priceId, locations)
}

/**
 * Brings the fee in line for every account whose billed locations differ from
 * what is due -- a clinic whose live date has just come, or that added or
 * archived a location. Called from the VeriFactu cron, which runs every
 * minute; the selection is one query, so a tick with nothing to change costs
 * no Stripe call at all.
 *
 * Prorated, like every other change to the subscription: a clinic that goes
 * live on the 10th pays for the 10th onwards.
 */
export async function syncVerifactuFees(serviceRole: SupabaseClient<Database>) {
  if (!useRuntimeConfig().stripePlatformBillingSecretKey) return { skipped: 'platform billing not configured' as const }

  const { data: due, error } = await serviceRole.rpc('verifactu_fee_out_of_sync', { p_limit: 10 })
  if (error) return { error: `verifactu fee: could not read what is due: ${error.message}` }
  if (!due?.length) return { changed: [] as unknown[] }

  const stripe = stripeForPlatformBilling()
  const results: Record<string, unknown>[] = []
  for (const row of due) {
    const attemptedAt = new Date().toISOString()
    try {
      const { data: sub } = await serviceRole
        .from('subscriptions')
        .select('stripe_subscription_id, billing_interval')
        .eq('account_id', row.account_id)
        .maybeSingle()
      const current = await retrieveChangeableSubscription(stripe, sub?.stripe_subscription_id)
      if (!current) {
        // Cancelled or gone: nothing to put the item on. It goes on with the
        // next Checkout (subscribe.post.ts), which reads what is due itself.
        await serviceRole.from('subscriptions').update({ verifactu_fee_attempted_at: attemptedAt }).eq('account_id', row.account_id)
        results.push({ account: row.account_id, skipped: 'no changeable subscription' })
        continue
      }
      // The interval the subscription actually bills on, read from its plan
      // item, rather than the row -- they only disagree when something else
      // is already wrong, and then Stripe's is the one that must match.
      const interval = current.items.data.some((i) => i.price.recurring?.interval === 'year') ? 'annual' : 'monthly'
      const change = await verifactuFeeItemFor(serviceRole, row.account_id, interval, current.items.data)
      if (change) {
        await stripe.subscriptions.update(current.id, { items: [change], proration_behavior: 'create_prorations' })
      }
      // Written now rather than left to the webhook, so the next tick does not
      // send the same change again while the event is in flight. The webhook
      // then writes the same number from Stripe's side.
      await serviceRole
        .from('subscriptions')
        .update({ verifactu_locations: row.due, verifactu_fee_attempted_at: attemptedAt })
        .eq('account_id', row.account_id)
      results.push({ account: row.account_id, from: row.billed, to: row.due })
    } catch (err) {
      await serviceRole.from('subscriptions').update({ verifactu_fee_attempted_at: attemptedAt }).eq('account_id', row.account_id)
      results.push({ account: row.account_id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { changed: results }
}
