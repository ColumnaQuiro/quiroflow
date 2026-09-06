import { COUNTRIES, countryByCode } from './countries'

// Staff routinely type or paste a number that already carries its dial
// prefix ("+34 600 123 456") into a field that has a separate country
// dropdown beside it. Storing that verbatim leaves the prefix in `number`
// *and* the country in `country_code`, so every screen that renders the two
// together reads "+34 +34 600 123 456". This splits the prefix back out so
// only the local part is stored, and points country_code at whichever
// country the prefix named rather than whatever the dropdown happened to
// be showing.
// How a stored number should read on screen. Plenty of numbers already carry
// their own "+" prefix -- online-booking signups, CSV imports, and anything
// typed with a dial code we don't list in COUNTRIES (splitDialPrefix leaves
// those alone rather than guessing). Prepending the country's dial code to
// one of those renders "+34 +34 600 123 456", so it's only added when the
// number doesn't already start with one.
export function formatPhoneDisplay(number: string, countryCode: string): string {
  const trimmed = number.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) return trimmed
  return `${countryByCode(countryCode).dial} ${trimmed}`
}

export function splitDialPrefix(input: string, fallbackCountryCode: string): { countryCode: string; number: string } {
  const trimmed = input.trim()
  if (!trimmed.startsWith('+')) return { countryCode: fallbackCountryCode, number: trimmed }

  const digits = trimmed.slice(1).replace(/\D/g, '')
  // Longest dial code first, so +351 (Portugal) is matched before +34 (Spain)
  // rather than being mistaken for a Spanish number starting with "1".
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial.slice(1)))
  if (!match) return { countryCode: fallbackCountryCode, number: trimmed }

  const local = digits.slice(match.dial.length - 1)
  // A prefix and nothing else isn't a number -- keep what was typed rather
  // than storing an empty string against a country.
  if (!local) return { countryCode: fallbackCountryCode, number: trimmed }
  return { countryCode: match.code, number: local }
}

// Best-effort E.164 normalization -- stored numbers are inconsistent
// (some already "+34 600123456" from online booking, some bare local
// digits with a separate country_code from the CSV import). Meta's Cloud
// API requires E.164 (digits only, no "+", no spaces) for the "to" field.
export function toE164(number: string, countryCode: string): string | null {
  const trimmed = number.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length >= 8 ? digits : null
  }

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  const dial = countryByCode(countryCode).dial.replace('+', '')
  return `${dial}${digits}`
}
