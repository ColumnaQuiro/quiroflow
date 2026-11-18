// What an imported appointment type should cost, from PracticeHub.
//
// PracticeHub keeps NO price on an appointment type. Its own type record has
// a `value` field, and it is 0.00 on every type read on 18 Nov 2026. The
// price is on a billable item (Settings > Billing > Services, `amount`), and
// a type points at it through "Default Services and/or Products" on the
// type's edit page. That link is in neither API: Classic's
// /appointment_types has no price or service field (only the online booking
// fee), Classic has no /billable_items at all, and 2.0's /appointment_types
// documents none. Only 2.0's /billable_items has the amounts.
//
// So a type is priced from the service OF THE SAME NAME, which is how
// PracticeHub's own setup names them ("Ajuste Quiropractico" the type,
// "Ajuste Quiropractico - 55.00" its default service). Inferring the link
// from invoice history was measured instead and is wrong too often:
// on the live account an "Informe" visit is usually invoiced with the
// adjustment item, so three of nine types came out with another type's price.
// A type with no same-named service, or two same-named services at different
// prices, gets no price rather than a guess; the clinic sets it here.

export interface PracticeHubBillableItem {
  id: number
  description: string | null
  /** "55.00": unit price, two decimals. Negative for a discount. */
  amount: string | null
  active?: boolean | null
}

export interface PracticeHubTypePrice {
  billableItemId: number
  serviceName: string
  priceCents: number
}

/** "Informe Quiropráctico " and "informe quiropractico" are the same name. */
function practiceHubPriceNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** A billable item's amount as cents, or null for none, a discount, or not a number. */
export function practiceHubServiceCents(amount: string | null | undefined): number | null {
  if (amount === null || amount === undefined) return null
  const text = String(amount).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  return Math.round(parseFloat(text) * 100)
}

/**
 * The price PracticeHub has for an appointment type: the amount of the
 * billable item with the same name. Null when no item has that name, or when
 * same-named items disagree on the price (preferring the ones not marked
 * inactive, since PracticeHub leaves `active` empty on items in daily use).
 */
export function practiceHubTypePrice(typeName: string, items: PracticeHubBillableItem[]): PracticeHubTypePrice | null {
  const key = practiceHubPriceNameKey(typeName)
  if (!key) return null
  const named = items.filter((item) => item.description && practiceHubPriceNameKey(item.description) === key && practiceHubServiceCents(item.amount) !== null)
  if (named.length === 0) return null
  const live = named.filter((item) => item.active !== false)
  const pool = live.length > 0 ? live : named
  const prices = new Set(pool.map((item) => practiceHubServiceCents(item.amount)))
  if (prices.size !== 1) return null
  const [first] = pool
  return { billableItemId: first!.id, serviceName: first!.description!.trim(), priceCents: [...prices][0]! }
}

/**
 * The price to write to a type, or null to leave it as it is.
 *
 * `ourPriceCents` is the type's price here, or null for a type the import is
 * about to create. A price the clinic has set here is never replaced: only a
 * type still at 0 -- what every import before this one left -- takes
 * PracticeHub's. A PracticeHub price of 0 writes nothing, since 0 is what the
 * type has already.
 */
export function practiceHubPriceToWrite(ourPriceCents: number | null, phPriceCents: number | null | undefined): number | null {
  if (!phPriceCents || phPriceCents <= 0) return null
  if (ourPriceCents === null || ourPriceCents === 0) return phPriceCents
  return null
}
