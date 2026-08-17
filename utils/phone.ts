import { countryByCode } from './countries'

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
