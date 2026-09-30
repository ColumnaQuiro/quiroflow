import { toE164 } from './phone'

// The staff contacts a clinic is alerted on (a new lead, an online booking).
// They were saved exactly as typed, and "600000000" without its +34 went to
// Meta as it was, which refused it -- and the failure was swallowed, so the
// clinic was simply never told. Checked and normalised when saved instead.

/** "+34600000000" for any way of typing the number; null when empty; undefined when not a number. */
export function normalizeNotifyWhatsapp(raw: string, defaultCountry: string): string | null | undefined {
  if (!raw.trim()) return null
  const digits = toE164(raw, defaultCountry)
  return digits ? `+${digits}` : undefined
}

/** The address, trimmed; null when empty; undefined when not an address. */
export function normalizeNotifyEmail(raw: string): string | null | undefined {
  const value = raw.trim()
  if (!value) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined
}
