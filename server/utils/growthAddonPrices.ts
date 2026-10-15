import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

export interface GrowthAddonPrices {
  /** The price for the interval being bought, or null if Stripe has none configured for it. */
  priceId: string | null
  /**
   * Both of them. Finding the item an existing subscription already carries
   * needs the other interval's price too, because switching monthly <-> annual
   * has to replace that item rather than add a second one.
   */
  allPriceIds: Set<string>
}

/**
 * Growth's Stripe prices, out of the `addons` catalogue.
 *
 * Its own helper rather than an inline query because three routes need the
 * same answer -- subscribe, preview and the billing webhook -- and
 * preview.post.ts exists specifically to show what subscribe.post.ts will do
 * moments later. Two copies of "which item is the Growth one" is exactly the
 * pair that drifts, and it drifts silently: the preview quotes one number and
 * the charge is another.
 */
export async function growthAddonPrices(
  serviceRole: SupabaseClient<Database>,
  interval: 'monthly' | 'annual',
): Promise<GrowthAddonPrices> {
  return addonPrices(serviceRole, 'growth', interval)
}

/**
 * The AI receptionist's, sold on its own (20261014184755_receptionist_addon.sql),
 * for the same three routes and for the same reason.
 */
export async function receptionistAddonPrices(
  serviceRole: SupabaseClient<Database>,
  interval: 'monthly' | 'annual',
): Promise<GrowthAddonPrices> {
  return addonPrices(serviceRole, 'receptionist', interval)
}

async function addonPrices(
  serviceRole: SupabaseClient<Database>,
  id: string,
  interval: 'monthly' | 'annual',
): Promise<GrowthAddonPrices> {
  const { data: addon } = await serviceRole
    .from('addons')
    .select('stripe_monthly_price_id, stripe_annual_price_id')
    .eq('id', id)
    .maybeSingle()

  const monthly = addon?.stripe_monthly_price_id ?? null
  const annual = addon?.stripe_annual_price_id ?? null

  return {
    priceId: interval === 'annual' ? annual : monthly,
    allPriceIds: new Set([monthly, annual].filter((id): id is string => !!id)),
  }
}
