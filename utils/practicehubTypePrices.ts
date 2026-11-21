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
//
// Only a LIVE service prices a type. QuiroBalance (20 Nov 2026) showed why:
// its "Ajuste" type is billed with "Chequeo quiropráctico y ajuste 2025" at
// 50.00, and the only service actually named "Ajuste " was retired at 30.00,
// so the import wrote 30 € -- wrong, and over a 0, so nothing flagged it.
// Its other types ("Informe", "Reevaluación", "Ajuste 30") share a name with
// no service at all. That is the common case outside Columnaquiro, so a type
// left without a price is named in the step's warnings rather than passed
// over in silence.
//
// Invoice history was measured again on 21 Nov across four clinics and is
// still no substitute. The highest amount billed regularly for a type got
// QuiroBalance right, but put 800 € on an Elevate adjustment (packages sold
// at the visit) and 70 € on Columnaquiro's 50 € first-visit offer. The most
// common amount picks the discounted rate (40 € for a 50 € adjustment).

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
 * The price PracticeHub has for an appointment type: the amount of the live
 * billable item with the same name. Null when no live item has that name, or
 * when same-named live items disagree on the price. "Live" is anything not
 * marked inactive, since PracticeHub leaves `active` empty on items in daily
 * use; a retired item never prices a type, even when it is the only one of
 * that name -- its amount is an old price.
 */
export function practiceHubTypePrice(typeName: string, items: PracticeHubBillableItem[]): PracticeHubTypePrice | null {
  const key = practiceHubPriceNameKey(typeName)
  if (!key) return null
  const live = items.filter((item) => item.active !== false && item.description && practiceHubPriceNameKey(item.description) === key && practiceHubServiceCents(item.amount) !== null)
  if (live.length === 0) return null
  const prices = new Set(live.map((item) => practiceHubServiceCents(item.amount)))
  if (prices.size !== 1) return null
  const [first] = live
  return { billableItemId: first!.id, serviceName: first!.description!.trim(), priceCents: [...prices][0]! }
}

/**
 * The warning for types the import leaves at 0: in use or bookable, no price
 * here, and none PracticeHub's API can give. Null when there are none.
 */
export function practiceHubUnpricedTypesWarning(names: string[], t: (en: string, es: string) => string): string | null {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (unique.length === 0) return null
  const list = unique.join(', ')
  return t(
    `No price in PracticeHub for: ${list}. PracticeHub's API does not say which service each type is charged with, and none of its active services has these names, so they stay at 0. Set them in Settings › Appointment types; a later sync never replaces them.`,
    `Sin precio en PracticeHub para: ${list}. La API de PracticeHub no dice con qué servicio se cobra cada tipo, y ninguno de sus servicios activos se llama así, así que se quedan a 0. Ponlos en Ajustes › Tipos de cita; una sincronización posterior nunca los sustituye.`,
  )
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
