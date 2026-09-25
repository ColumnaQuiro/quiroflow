// The rules an appointment type is held to, and the order types are listed
// in -- shared by Settings -> Appointment Types and everything that offers a
// type to pick from.
//
// The same rules are restated as constraints on appointment_types
// (20260925140512_appointment_types_archive_order_and_rules.sql). They are
// checked here first so the page can say which field is wrong before the
// save, rather than relaying a constraint name after it.

/**
 * appointment_types.stage. The Statistics report counts first visits,
 * reports, revisions and so on by this -- a type with no stage is left out of
 * those counts, which is why the list flags it.
 */
export const TYPE_STAGES = [
  { value: 'first_visit', en: 'First visit', es: 'Primera visita' },
  { value: 'first_visit_offer', en: 'First visit (offer)', es: 'Primera visita con oferta' },
  { value: 'report', en: 'Report / exam findings', es: 'Informe' },
  { value: 'revision', en: 'Revision / check-up', es: 'Revisión' },
  { value: 'maintenance', en: 'Maintenance', es: 'Mantenimiento' },
  { value: 'adjustment', en: 'Adjustment', es: 'Ajuste' },
  { value: 'other', en: 'Other', es: 'Otro' },
] as const

export const DURATION_MIN = 5
export const DURATION_MAX = 480

/**
 * Euros as typed in Spain -- "60", "60,5", "60,00", "1.234,50" -- to cents.
 * Also takes a point as the decimal separator when there is exactly one and
 * it is followed by one or two digits, because "60.00" is what a number field
 * or a paste from elsewhere produces.
 *
 * null: left empty. NaN: not an amount.
 */
export function parseEurosToCents(text: string): number | null {
  const raw = text.replace(/€/g, '').replace(/\s/g, '')
  if (raw === '') return null
  let normal: string
  if (raw.includes(',')) {
    // Comma is the decimal separator; points are thousands.
    normal = raw.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+\.\d{1,2}$/.test(raw)) {
    normal = raw
  } else {
    normal = raw.replace(/\./g, '')
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(normal)) return Number.NaN
  return Math.round(parseFloat(normal) * 100)
}

/** Cents to what the price field shows: "60,00", no currency sign. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
}

/**
 * Whole minutes, or null when empty, or NaN when not a whole number.
 *
 * Takes a number too: v-model on an <input type="number"> hands back a number
 * once something is typed, and a string before -- calling .trim() on the
 * number threw inside the page's validation and took the save with it.
 */
export function parseMinutes(text: string | number | null | undefined): number | null {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : Number.NaN
}

/** How the database compares names: case and surrounding spaces ignored. */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('es-ES')
}

export interface TypeRules {
  id?: string | null
  name: string
  duration: string | number
  price: string
  paymentRequired: boolean
  deposit: string
  maxDaysAhead: string | number
}

export type TypeProblem =
  | 'name_missing'
  | 'name_taken'
  | 'duration_invalid'
  | 'price_invalid'
  | 'deposit_invalid'
  | 'deposit_over_price'
  | 'max_days_invalid'

/**
 * What is wrong with a type as typed, field by field. `others` are the
 * account's OTHER active types -- archived ones may share a name (the unique
 * index leaves them out), so the caller passes only the active ones.
 */
export function typeProblems(form: TypeRules, others: { id: string; name: string }[]): Partial<Record<'name' | 'duration' | 'price' | 'deposit' | 'maxDays', TypeProblem>> {
  const out: Partial<Record<'name' | 'duration' | 'price' | 'deposit' | 'maxDays', TypeProblem>> = {}

  if (!form.name.trim()) out.name = 'name_missing'
  else if (others.some((o) => o.id !== form.id && nameKey(o.name) === nameKey(form.name))) out.name = 'name_taken'

  const minutes = parseMinutes(form.duration)
  if (minutes === null || Number.isNaN(minutes) || minutes < DURATION_MIN || minutes > DURATION_MAX) out.duration = 'duration_invalid'

  const price = parseEurosToCents(form.price)
  // An empty price is 0, not an error: "0 if it is not charged" is the hint.
  if (price !== null && (Number.isNaN(price) || price < 0)) out.price = 'price_invalid'

  if (form.paymentRequired) {
    const deposit = parseEurosToCents(form.deposit)
    if (deposit !== null) {
      if (Number.isNaN(deposit) || deposit < 0) out.deposit = 'deposit_invalid'
      else if (!out.price && deposit > (price ?? 0)) out.deposit = 'deposit_over_price'
    }
  }

  const days = parseMinutes(form.maxDaysAhead)
  if (days !== null && (Number.isNaN(days) || days < 1 || days > 730)) out.maxDays = 'max_days_invalid'

  return out
}

/**
 * The order types are offered in: the clinic's own (sort_order), then by
 * name for rows that have none yet or share a position. The calendar
 * proposes the first one, so this is also "which type is the default".
 */
export function orderTypes<T extends { name: string; sort_order?: number | null }>(types: T[]): T[] {
  return [...types].sort((a, b) => {
    const sa = a.sort_order ?? Number.POSITIVE_INFINITY
    const sb = b.sort_order ?? Number.POSITIVE_INFINITY
    if (sa !== sb) return sa < sb ? -1 : 1
    return a.name.localeCompare(b.name, 'es')
  })
}

/** A copy of `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!)
  return next
}
