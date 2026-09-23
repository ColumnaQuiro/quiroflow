// Why Supabase refused a password, as a value rather than a sentence.
//
// With leaked-password protection on, every password being SET -- signup,
// reset, change -- is checked against HaveIBeenPwned's breach corpus and
// refused on a match. What comes back is accurate and unhelpful:
//
//   "Password is known to be weak and easy to guess, please choose a
//    different one."
//
// Hardcoded English on a clinic that works in Spanish, and it buries the one
// thing the person needs: this is not a rule about length or symbols, it is
// that THIS password is already in a public breach list. Someone told "weak
// and easy to guess" about a password they consider strong will add a digit
// and try again, which changes nothing.
//
// Split out from the wording on purpose. Recognising the error is the part
// that can break and the part worth testing; the words around it live in
// useAuthPasswordError, which needs a Nuxt context for useT() and so cannot
// be imported into a spec.
//
// Matched on auth-js's own contract, never on that sentence. It throws
// AuthWeakPasswordError -- code 'weak_password', name 'AuthWeakPasswordError'
// -- carrying a `reasons` array: ['pwned'] for a breach match, ['length'] or
// ['characters'] for the strength rules. Reading the message text would break
// the first time Supabase rewords it, and could not tell a breached password
// from a short one, which need opposite advice.

export type PasswordRejection = 'pwned' | 'length' | 'characters' | 'weak' | null

/** The shapes auth-js hands back; `reasons` exists only on the weak-password error. */
export interface SupabaseAuthErrorLike {
  message?: string
  code?: string
  name?: string
  reasons?: string[]
}

/**
 * null when this is not a password-strength refusal at all -- a wrong
 * clinic code, a duplicate email, the network being down. Those keep their
 * own message, which is already the right one.
 */
export function passwordRejection(error: unknown): PasswordRejection {
  if (!error || typeof error !== 'object') return null
  const err = error as SupabaseAuthErrorLike

  const isWeak = err.code === 'weak_password' || err.name === 'AuthWeakPasswordError'
  if (!isWeak) return null

  const reasons = Array.isArray(err.reasons) ? err.reasons : []

  // Checked before the strength rules: a password can be both breached and
  // short, and "it is in a breach list" is the fact that changes what to do
  // about it.
  if (reasons.includes('pwned')) return 'pwned'
  if (reasons.includes('length')) return 'length'
  if (reasons.includes('characters')) return 'characters'
  return 'weak'
}
