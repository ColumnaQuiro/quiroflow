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
  // A country we don't have a dial code for prints bare. Guessing one is how
  // a Belgian number came to read as "+34 478 956 575" -- a wrong number,
  // not merely an unformatted one.
  const { dial } = countryByCode(countryCode)
  return dial ? `${dial} ${trimmed}` : trimmed
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

// Is this plausibly a phone number, rather than something typed to get past a
// `required` attribute?
//
// `required` and type="tel" together accept one character: a patient booked
// online on 24 Sep 2026 having picked +34 and typed "6", and the clinic had a
// confirmed appointment with no way to reach the person who made it. Nothing
// downstream can recover from that -- toE164 happily builds "346", WhatsApp
// accepts the send and it goes nowhere.
//
// Measured against the length of the NATIONAL number, after stripping any
// dial prefix the typist included, so "+34 600 123 456" and "600 123 456" are
// judged the same way.
//
// Spain gets an exact length because it is where this clinic's patients are
// and the rule is unambiguous: every Spanish number, mobile or landline, is
// nine digits. The leading digit is deliberately NOT checked -- the field
// says "móvil", but a patient who gives their landline should still get an
// appointment.
//
// Everywhere else gets a floor and a ceiling instead of a per-country length.
// Ninety countries' numbering plans is not a list this repo can keep honest,
// and countries.ts already records what over-confident guessing costs: a
// Belgian number rendered as a real Spanish one belonging to somebody else.
// A wrong guess here would refuse a real patient at the last step of a
// booking, which is worse than admitting an implausible number.
//
// create_public_booking re-states these same three rules in SQL, because the
// RPC is security definer and anon can call it without going near the form.
// Keep the two in step by hand.
export const MIN_PHONE_DIGITS = 6
export const MAX_PHONE_DIGITS = 15
export const ES_PHONE_DIGITS = 9

export function looksLikePhoneNumber(input: string, countryCode: string): boolean {
  // The country the NUMBER names, not the one the dropdown happens to show:
  // a patient who leaves it on Spain and pastes "+44 7700 900123" is giving
  // a British number, and judging that by Spain's nine digits would refuse a
  // real one.
  const { countryCode: resolved, number } = splitDialPrefix(input.trim(), countryCode)
  const digits = number.replace(/\D/g, '')
  if (resolved === 'ES') return digits.length === ES_PHONE_DIGITS
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS
}

// Best-effort E.164 normalization -- stored numbers are inconsistent
// (some already "+34 600123456" from online booking, some bare local
// digits with a separate country_code from the CSV import). Meta's Cloud
// API requires E.164 (digits only, no "+", no spaces) for the "to" field.
export function toE164(number: string, countryCode: string): string | null {
  const trimmed = number.trim()
  if (!trimmed) return null

  // "00" is the internationally-dialled equivalent of "+" outside a handful
  // of countries (the US/Canada use "011" instead, but nobody here is
  // typing that) -- treat it the same way rather than digit-stripping the
  // "00" into the number and doubling up on a locally-prepended dial code.
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
    const rest = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed.slice(2)
    const digits = rest.replace(/\D/g, '')
    return digits.length >= 8 ? digits : null
  }

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  // Same reasoning as formatPhoneDisplay: without a dial code for this
  // country there is no honest E.164 to build, and prefixing Spain's would
  // send the message to whoever owns that number in Spain.
  const dial = countryByCode(countryCode).dial.replace('+', '')
  if (!dial) return null
  return `${dial}${digits}`
}

// How many trailing digits are compared when toE164() can't be trusted to
// agree exactly -- long enough to be a full mobile number in every country
// COUNTRIES lists, short enough to still match if the country code (or the
// "+"/"00" prefix) was wrong or missing when the number was stored.
const SIGNIFICANT_DIGITS = 9

function significantDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(-SIGNIFICANT_DIGITS)
}

// Matches a stored contact number against an incoming WhatsApp message's
// "from" number (already bare E.164 digits, no "+"). Falls back to comparing
// only the last SIGNIFICANT_DIGITS when the exact E.164 reconstruction
// doesn't match -- e.g. a `patient_contact_numbers.country_code` left at its
// 'ES' default for a foreign number (see 0078_fix_public_booking_phone_dial_code.sql
// for a prior instance of exactly this), or a number typed with a leading
// "00" that toE164 didn't yet know to treat like "+". Without this, those
// patients' WhatsApp replies never match and the inbox shows their bare
// phone number instead of their name.
/**
 * What a webhook sent, as E.164.
 *
 * Meta's lead-ads payload, WhatsApp's webhook and anything that has been
 * through an n8n `replace('+','')` all deliver a number with no "+" on the
 * front -- "34612345678". toE164 reads that as a local number and prepends
 * the dial code again, producing "3434612345678" and a message to nobody.
 *
 * The plus-less case is genuinely ambiguous: a Spanish local mobile
 * "612345678" also starts with a real dial code (+61, Australia), so a rule
 * that trusts any leading dial code would silently reroute Spanish numbers
 * abroad. This deliberately does not try to be clever about that. It treats
 * plus-less digits as already-E.164 only when they start with the dial code
 * of the country we were told to assume AND there is a plausible local
 * number left over -- which covers every real caller here, and leaves every
 * genuinely ambiguous string being read as a local number, the same as before.
 */
export function toE164Loose(input: string, countryCode: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) return toE164(trimmed, countryCode)

  const digits = trimmed.replace(/\D/g, '')
  const dial = countryByCode(countryCode).dial.replace('+', '')
  if (dial && digits.startsWith(dial) && digits.length - dial.length >= 6) return digits

  return toE164(digits, countryCode)
}

export function phoneMatches(storedNumber: string, storedCountryCode: string, incomingE164: string): boolean {
  if (toE164(storedNumber, storedCountryCode) === incomingE164) return true
  const stored = significantDigits(storedNumber)
  return stored.length === SIGNIFICANT_DIGITS && stored === significantDigits(incomingE164)
}
