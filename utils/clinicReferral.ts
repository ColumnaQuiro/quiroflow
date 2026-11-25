// The clinic-to-clinic referral offer, as the "¡Recomienda a tus amigos!"
// dialog states it and the platform billing webhook applies it
// (server/utils/clinicReferralRewards.ts): when a clinic that signed up through
// another clinic's link starts paying, both get this share of their regular
// plan's MONTHLY price off one invoice.
export const CLINIC_REFERRAL_DISCOUNT_PERCENT = 10

/**
 * The discount, in cents, for a plan whose monthly price is `monthlyPriceCents`
 * (ex-VAT, as `plans.monthly_price_cents` stores it). Null when there is
 * nothing to discount.
 *
 * Always the monthly price, whatever interval the clinic pays on: the offer is
 * one month of the plan, so an annual payer gets the same euros off its next
 * annual invoice rather than 10% of a whole year. Add-ons (Growth, seats,
 * locations, VeriFactu) are not the "regular subscription" and are left out.
 */
export function clinicReferralRewardCents(monthlyPriceCents: number | null | undefined): number | null {
  if (!monthlyPriceCents || monthlyPriceCents <= 0) return null
  const cents = Math.round((monthlyPriceCents * CLINIC_REFERRAL_DISCOUNT_PERCENT) / 100)
  return cents > 0 ? cents : null
}

/** The bits of a Stripe invoice the reward logic reads (structurally typed, so this file stays free of the SDK). */
export interface ReferralInvoiceView {
  status: string | null
  total: number
  discounts: Array<string | { id: string; source?: { coupon?: string | { id: string } | null } | null }>
}

/** A reward row as far as deciding what to do with it goes. */
export interface ReferralRewardView {
  status: string
  stripe_coupon_id: string | null
}

/** Coupon ids already on an invoice, from discounts expanded or not. */
export function invoiceCouponIds(invoice: Pick<ReferralInvoiceView, 'discounts'>): Set<string> {
  const ids = new Set<string>()
  for (const d of invoice.discounts ?? []) {
    if (typeof d === 'string') continue
    const coupon = d.source?.coupon
    if (typeof coupon === 'string') ids.add(coupon)
    else if (coupon?.id) ids.add(coupon.id)
  }
  return ids
}

/**
 * What to do with a pending reward when an invoice for its clinic is created:
 *
 * - 'record' -- its coupon is already on the invoice. That is the Checkout
 *   path: a clinic paying straight away is charged on an invoice Stripe
 *   finalises at once, so the coupon rode in on the Checkout Session and only
 *   needs writing down.
 * - 'attach' -- a draft with something to pay. Renewals and the first invoice
 *   after a trial stay drafts for about an hour, which is the window to add it.
 * - 'skip' -- anything else: a 0 EUR trial invoice (a one-use coupon spent
 *   there would be wasted), or one already finalised. The reward stays pending
 *   for the next invoice.
 */
export function referralRewardAction(reward: ReferralRewardView, invoice: ReferralInvoiceView): 'record' | 'attach' | 'skip' {
  if (reward.status !== 'pending') return 'skip'
  if (reward.stripe_coupon_id && invoiceCouponIds(invoice).has(reward.stripe_coupon_id)) return 'record'
  if (invoice.status === 'draft' && invoice.total > 0) return 'attach'
  return 'skip'
}

/**
 * A referral earns nothing when both clinics have an owner in common: that is
 * one person referring themselves, by opening a second account through their
 * own link.
 */
export function sharesAnOwner(ownersA: Iterable<string | null>, ownersB: Iterable<string | null>): boolean {
  const a = new Set([...ownersA].filter((u): u is string => !!u))
  for (const u of ownersB) if (u && a.has(u)) return true
  return false
}
