import type Stripe from 'stripe'

/**
 * How a clinic pays QuiroFlow, as /subscription shows it. Not always a card:
 * Checkout offers Stripe Link, and a clinic that pays with Link has a
 * payment method of type `link` with no brand, last four or expiry at all.
 * `last4` and the expiry are therefore null for anything but a card (and
 * `last4` is set for a SEPA mandate).
 */
export interface BillingPaymentMethod {
  brand: string
  last4: string | null
  expMonth: number | null
  expYear: number | null
}

export function describeBillingPaymentMethod(pm: Stripe.PaymentMethod | string | null | undefined): BillingPaymentMethod | null {
  if (!pm || typeof pm === 'string') return null
  switch (pm.type) {
    case 'card':
      return pm.card ? { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year } : null
    case 'link':
      return { brand: 'Link', last4: null, expMonth: null, expYear: null }
    case 'sepa_debit':
      return { brand: 'SEPA', last4: pm.sepa_debit?.last4 ?? null, expMonth: null, expYear: null }
    default:
      return { brand: pm.type, last4: null, expMonth: null, expYear: null }
  }
}

/**
 * The method Stripe will actually charge, in the order Stripe itself picks
 * it: the subscription's own default, then the customer's invoice default,
 * then whatever is saved on the customer.
 *
 * The subscription's default is the one that matters most and the one this
 * page used to ignore. Checkout saves the method there, not on the customer,
 * so a clinic that had paid -- and would be charged automatically on renewal
 * -- was shown "No card on file" and an "Add payment method" button. The
 * last fallback lists every type, not just cards, for the same reason: a
 * Link-only customer has no card to find.
 */
export async function resolveBillingPaymentMethod(
  stripe: Stripe,
  customerId: string,
  candidates: (Stripe.PaymentMethod | string | null | undefined)[],
): Promise<BillingPaymentMethod | null> {
  for (const candidate of candidates) {
    if (!candidate) continue
    const pm = typeof candidate === 'string' ? await stripe.paymentMethods.retrieve(candidate).catch(() => null) : candidate
    const found = describeBillingPaymentMethod(pm)
    if (found) return found
  }
  const saved = await stripe.customers.listPaymentMethods(customerId, { limit: 1 })
  return describeBillingPaymentMethod(saved.data[0])
}
