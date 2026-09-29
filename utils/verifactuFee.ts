// The VeriFactu fee's line on the platform subscription: 7,50 EUR a month per
// active clinic location, from the day the clinic goes live
// (verifactu_fee_locations() says how many are due).
//
// One decision, three callers: the cron that keeps the quantity in step, and
// subscribe/preview, which rebuild the subscription's items when an owner
// changes plan. The last two matter for the INTERVAL: every item on a Stripe
// subscription must bill on the same one, so switching monthly -> annual
// with the fee still on its monthly price is refused outright. Kept here, a
// plain module, so all three answer the same way and it can be unit-tested.

export interface SubscriptionItemRef {
  id: string
  priceId: string
  quantity: number
}

export type SubscriptionItemChange =
  | { price: string; quantity: number }
  | { id: string; price: string; quantity: number }
  | { id: string; deleted: true }

/** The fee's item among a subscription's items, by any of its prices. */
export function findVerifactuFeeItem(items: SubscriptionItemRef[], feePriceIds: Set<string>): SubscriptionItemRef | null {
  return items.find((item) => feePriceIds.has(item.priceId)) ?? null
}

/**
 * What to send Stripe for the fee's item, or null when it is already right.
 *
 * `priceId` is the price for the subscription's interval (after the change,
 * for subscribe/preview). No price configured and nothing due is nothing to
 * do; no price configured with something due is also nothing -- the caller
 * decides whether that is an error, since the fee must never block a plan
 * change.
 */
export function verifactuFeeItemChange(
  existing: SubscriptionItemRef | null,
  priceId: string | null,
  locations: number,
): SubscriptionItemChange | null {
  if (locations <= 0) return existing ? { id: existing.id, deleted: true } : null
  if (!priceId) return null
  if (!existing) return { price: priceId, quantity: locations }
  if (existing.priceId === priceId && existing.quantity === locations) return null
  return { id: existing.id, price: priceId, quantity: locations }
}
