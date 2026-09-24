// Two-factor login (an authenticator-app code on top of the password), shared
// by the web app and the mobile app. The factor itself is Supabase Auth's own
// TOTP MFA; what the database adds is that a password-only session reads
// nothing while two-factor applies to that person -- see
// supabase/migrations/20260923174910_two_factor_login.sql.
//
// No `~/` value imports in here: this file is also compiled into mobile/,
// where `~` means mobile/ (see mobile/nuxt.config.ts).

// 'verify': has set it up, has not entered the code in this session yet.
// 'enroll': their clinic requires it and they have not set it up.
export type TwoFactorGate = 'ok' | 'verify' | 'enroll'

export interface TwoFactorEnrollment {
  factorId: string
  qrCode: string
  secret: string
  uri: string
}

export function useTwoFactor() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  // Only an 'ok' for a password-only session is remembered, and only for
  // this page load and this user. It is the answer the database gives the
  // most people (no two-factor anywhere), and asking again on every route
  // change would be a round trip per click. An aal2 session never asks at
  // all; anything else is asked every time, because it is about to change.
  const cachedOk = useState<string | null>('two-factor-ok-for', () => null)

  async function gate(): Promise<TwoFactorGate> {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    // No session at all: nothing to gate, and asking the database would ask
    // it as anon -- which says 'ok' and would be remembered for this user.
    if (!aal?.currentLevel || aal.currentLevel === 'aal2') return 'ok'

    // The session's own copy of the user's factors is enough to say "has
    // one": nextLevel is aal2 exactly when a verified factor is on it.
    if (aal.nextLevel === 'aal2') return 'verify'

    const userId = user.value?.sub ?? null
    if (userId && cachedOk.value === userId) return 'ok'

    // The session's copy can be stale -- set up on another device after this
    // one signed in -- and whether the CLINIC requires it is not in the
    // session at all. The database knows both.
    const { data, error } = await supabase.rpc('get_my_two_factor_gate')
    // Fail open in the UI only. The database still refuses the reads, so
    // the worst case is empty pages, never data that should be locked.
    if (error || !data) return 'ok'
    const result = data as TwoFactorGate
    if (result === 'ok' && userId) cachedOk.value = userId
    return result
  }

  function forget() {
    cachedOk.value = null
  }

  async function verifiedFactorId(): Promise<string | null> {
    const { data } = await supabase.auth.mfa.listFactors()
    return data?.totp?.[0]?.id ?? null
  }

  async function isEnabled(): Promise<boolean> {
    return (await verifiedFactorId()) !== null
  }

  /** When the verified authenticator was set up, or null if there is none. */
  async function enabledSince(): Promise<string | null> {
    const { data } = await supabase.auth.mfa.listFactors()
    return data?.totp?.[0]?.created_at ?? null
  }

  // Codes are 6 digits; people paste them with spaces ("123 456") or with
  // the app's own dash.
  function cleanCode(code: string) {
    return code.replace(/\D/g, '')
  }

  async function verify(code: string): Promise<string | null> {
    const factorId = await verifiedFactorId()
    if (!factorId) return 'No authenticator is set up on this login.'
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: cleanCode(code) })
    if (error) return error.message
    forget()
    return null
  }

  async function startEnroll(): Promise<{ enrollment: TwoFactorEnrollment | null; error: string | null }> {
    // An abandoned set-up leaves an unverified factor behind, and GoTrue
    // refuses a second one with the same (empty) friendly name. They count
    // for nothing -- only verified factors log anyone in -- so clear them.
    const { data: factors } = await supabase.auth.mfa.listFactors()
    for (const f of factors?.all ?? []) {
      if (f.factor_type === 'totp' && f.status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'QuiroFlow' })
    if (error || !data) return { enrollment: null, error: error?.message ?? 'Could not start two-factor set-up.' }
    return {
      enrollment: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri },
      error: null,
    }
  }

  async function confirmEnroll(factorId: string, code: string): Promise<string | null> {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: cleanCode(code) })
    if (error) return error.message
    forget()
    return null
  }

  async function cancelEnroll(factorId: string) {
    await supabase.auth.mfa.unenroll({ factorId })
  }

  // Needs an aal2 session -- GoTrue refuses to remove a verified factor
  // otherwise, which is what stops a stolen password from switching it off.
  async function remove(): Promise<string | null> {
    const factorId = await verifiedFactorId()
    if (!factorId) return null
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) return error.message
    forget()
    return null
  }

  return { gate, forget, isEnabled, enabledSince, verify, startEnroll, confirmEnroll, cancelEnroll, remove }
}
