// Spanish tax identifiers -- DNI, NIE, the K/L/M NIFs and a company's CIF --
// as the AEAT checks them.
//
// A patient's national_id goes out as <NIF> in the VeriFactu destinatario,
// and the AEAT is unforgiving about it in two different ways:
//
//   * a value that is not NIF-SHAPED -- "12.345.678-Z", "x1234567l " with a
//     space, a passport number -- fails the schema (NIFType is nine
//     characters). That is a 4102 SOAP fault, and a fault rejects the WHOLE
//     envelope: every other clinic record in the batch goes back with it.
//   * a nine-character value with the wrong check letter passes the schema
//     and is refused per record: 1239 "Error en el bloque Destinatario".
//
// So the form normalises what reception types, and the sender only emits a
// value that passes here. Pure on purpose: auto-imported by the staff app
// too, where `~` means mobile/.

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
const CIF_CONTROL_LETTERS = 'JABCDEFGHI'

export type SpanishTaxIdType = 'DNI' | 'NIE' | 'NIF' | 'CIF'

export type TaxIdCheck =
  /** Nothing typed. */
  | { kind: 'empty' }
  /** A real Spanish identifier, in the nine-character form the AEAT wants. */
  | { kind: 'valid'; normalized: string; type: SpanishTaxIdType }
  /**
   * Shaped like a Spanish identifier, but its check character is wrong --
   * almost always a typo. The AEAT refuses it (1239).
   */
  | { kind: 'invalid'; normalized: string; type: SpanishTaxIdType }
  /**
   * Not a Spanish identifier at all: a passport, a foreign ID card. Fine to
   * keep on the record, but it cannot go to the AEAT as a NIF.
   */
  | { kind: 'other'; normalized: string }

/**
 * Uppercase, with the separators people type removed: spaces, dashes, dots
 * and slashes. "12.345.678-z" -> "12345678Z". A leading "ES" (the VAT form,
 * ES12345678Z) is dropped when what follows is nine characters.
 */
export function normalizeTaxId(raw: string | null | undefined): string {
  const compact = (raw ?? '').toUpperCase().replace(/[\s.\-/]/g, '')
  if (/^ES[0-9A-Z]{9}$/.test(compact)) return compact.slice(2)
  return compact
}

function dniLetter(digits: string): string {
  return DNI_LETTERS[Number(digits) % 23]!
}

function cifControl(sevenDigits: string): { digit: string; letter: string } {
  let sum = 0
  for (let i = 0; i < 7; i++) {
    const n = Number(sevenDigits[i])
    if (i % 2 === 0) {
      // Odd positions (1st, 3rd, 5th, 7th): doubled, and its digits added.
      const doubled = n * 2
      sum += Math.floor(doubled / 10) + (doubled % 10)
    } else {
      sum += n
    }
  }
  const digit = (10 - (sum % 10)) % 10
  return { digit: String(digit), letter: CIF_CONTROL_LETTERS[digit]! }
}

export function checkSpanishTaxId(raw: string | null | undefined): TaxIdCheck {
  let id = normalizeTaxId(raw)
  if (!id) return { kind: 'empty' }

  // A DNI typed without its leading zeros -- 1234567L for 01234567L -- is
  // the same DNI. Padded only when that is the only reading.
  if (/^[0-9]{1,7}[A-Z]$/.test(id)) id = id.padStart(9, '0')

  let m = /^([0-9]{8})([A-Z])$/.exec(id)
  if (m) return { kind: dniLetter(m[1]!) === m[2] ? 'valid' : 'invalid', normalized: id, type: 'DNI' }

  m = /^([XYZ])([0-9]{7})([A-Z])$/.exec(id)
  if (m) {
    const digits = String('XYZ'.indexOf(m[1]!)) + m[2]
    return { kind: dniLetter(digits) === m[3] ? 'valid' : 'invalid', normalized: id, type: 'NIE' }
  }

  // K (under-14s), L (non-resident Spaniards), M (foreigners without a NIE):
  // the check letter is computed on the seven digits, as for a DNI.
  m = /^([KLM])([0-9]{7})([A-Z])$/.exec(id)
  if (m) return { kind: dniLetter(m[2]!) === m[3] ? 'valid' : 'invalid', normalized: id, type: 'NIF' }

  // A company or other legal entity. Some kinds take a control letter, some a
  // digit, the rest accept either.
  m = /^([ABCDEFGHJNPQRSUVW])([0-9]{7})([0-9A-J])$/.exec(id)
  if (m) {
    const { digit, letter } = cifControl(m[2]!)
    const kind = m[1]!
    const control = m[3]!
    const ok = 'PQRSWN'.includes(kind)
      ? control === letter
      : 'ABEH'.includes(kind)
        ? control === digit
        : control === digit || control === letter
    return { kind: ok ? 'valid' : 'invalid', normalized: id, type: 'CIF' }
  }

  return { kind: 'other', normalized: normalizeTaxId(raw) }
}

/**
 * The identifier in the form the AEAT accepts as <NIF>, or null when it is not
 * a valid Spanish one. The only thing the VeriFactu sender may put in <NIF>.
 */
export function validSpanishTaxId(raw: string | null | undefined): string | null {
  const check = checkSpanishTaxId(raw)
  return check.kind === 'valid' ? check.normalized : null
}
