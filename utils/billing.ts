// Money and dates for the subscription screens.
//
// Nothing on /subscription formats a currency or a date inline any more. It
// used to, and the page ended up printing es-ES money inside en-US dates in
// the same sentence ("21,00 € on November 21, 2026"), because each call site
// picked its own locale.
//
// The rule that matters most here is the separation between what a plan
// COSTS PER MONTH and what the NEXT CHARGE will be. They are different
// numbers on an annual plan -- the charge is twelve months at once -- and
// they were once produced by the same helper, so an annual customer was told
// their next payment was 44,00 € while Stripe took 528,00 €. There is
// deliberately no function here that can be asked for "the price" without
// saying which of the two it means.

/** Spain is the only market today; both formats are fixed to it deliberately. */
const LOCALE = 'es-ES'

export const MONTHS_PER_YEAR = 12

export function formatEur(cents: number): string {
  return (cents / 100).toLocaleString(LOCALE, { style: 'currency', currency: 'EUR' })
}

/** "21 de octubre de 2026". */
export function formatLongDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * "in 21 days" / "today" / "3 days ago", from whole days between the two
 * dates. Intl.RelativeTimeFormat rather than a hand-rolled table so the
 * Spanish reads correctly ("dentro de 21 días") when the UI is in Spanish.
 */
export function formatRelativeDays(iso: string | Date, language: 'en' | 'es', now = new Date()): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (days === 0) return language === 'es' ? 'hoy' : 'today'
  return new Intl.RelativeTimeFormat(language === 'es' ? 'es-ES' : 'en-GB', { numeric: 'auto' }).format(days, 'day')
}

export type BillingInterval = 'monthly' | 'annual'

export interface PlanPricing {
  monthlyPriceCents: number
  annualPriceCents: number
  extraProfessionalPriceCents: number | null
}

export interface AddonPricing {
  monthlyPriceCents: number
  annualPriceCents: number
}

export interface SubscriptionShape {
  interval: BillingInterval
  extraProfessionals: number
  /** Whether the add-on is actually bought AND billed as its own line. */
  growthBilled: boolean
}

/**
 * What one month of this configuration costs, ex-IVA.
 *
 * On an annual subscription this is the discounted per-month figure -- the
 * number a plan card shows next to "/mo". It is NEVER what gets charged on an
 * annual plan; see nextChargeTotal.
 */
export function pricePerMonth(
  plan: PlanPricing,
  subscription: SubscriptionShape,
  addon: AddonPricing | null,
): number {
  const annual = subscription.interval === 'annual'
  const base = annual ? plan.annualPriceCents : plan.monthlyPriceCents
  const seats = subscription.extraProfessionals * (plan.extraProfessionalPriceCents ?? 0)
  const growth = subscription.growthBilled && addon ? (annual ? addon.annualPriceCents : addon.monthlyPriceCents) : 0
  return base + seats + growth
}

/**
 * What the next invoice will be for, ex-IVA -- twelve times the per-month
 * figure on an annual plan, and equal to it on a monthly one.
 *
 * This is a LOCAL ESTIMATE. Prefer the amount Stripe reports on the upcoming
 * invoice whenever it is available (billing-info returns it): Stripe knows
 * about prorations, credits, coupons and the exact tax rate, and this
 * function knows about none of them. Use this only as the fallback for an
 * account whose Stripe customer cannot be read.
 */
export function nextChargeTotal(
  plan: PlanPricing,
  subscription: SubscriptionShape,
  addon: AddonPricing | null,
): number {
  const perMonth = pricePerMonth(plan, subscription, addon)
  return subscription.interval === 'annual' ? perMonth * MONTHS_PER_YEAR : perMonth
}

/** The six states a subscription can be in, as the UI names them. */
export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'locked' | 'canceled' | 'comped'

/**
 * Status plus the comped flag collapsed into the one value every pill, banner
 * and guard reads. Comped wins over the row's own status: a complimentary
 * account carries status 'trialing' forever and must never be told its trial
 * is ending.
 */
export function subscriptionState(status: string, comped: boolean): SubscriptionState {
  if (comped) return 'comped'
  if (status === 'trialing' || status === 'active' || status === 'past_due' || status === 'locked' || status === 'canceled') {
    return status
  }
  // An unrecognised status is not silently treated as healthy.
  return 'locked'
}

/**
 * Seat ceiling for a plan, or null for "no limit".
 *
 * Comped accounts genuinely have no ceiling -- practitioner_seat_allowance()
 * returns null for them -- so printing "3 of 1 seats in use" claimed a limit
 * that does not exist.
 */
export function seatAllowance(
  includedProfessionals: number | null | undefined,
  extraProfessionals: number,
  comped: boolean,
): number | null {
  if (comped) return null
  if (includedProfessionals === null || includedProfessionals === undefined) return null
  return includedProfessionals + extraProfessionals
}

const GB = 1024 ** 3

export function bytesToGb(bytes: number): number {
  return bytes / GB
}

/** "19,8 GB" -- two decimals below 10 GB, one above, so small numbers stay legible. */
export function formatGb(gb: number): string {
  return `${gb.toLocaleString(LOCALE, { minimumFractionDigits: gb < 10 ? 2 : 1, maximumFractionDigits: gb < 10 ? 2 : 1 })} GB`
}

/** 0-100, clamped. Storage is headroom, so going over does not change the tone. */
export function meterPercent(used: number, allowance: number | null): number | null {
  if (!allowance) return null
  return Math.min(100, Math.max(0, Math.round((used / allowance) * 100)))
}
