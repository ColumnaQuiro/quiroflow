// Face ID (Touch ID, the Android fingerprint) to get into the app, the way a
// bank's app does it. Optional and per device: offered once after signing in
// (AppFaceIdOffer) and switched in Profile / Cuenta (FaceIdSetting).
//
// Two things it does once switched on:
//
//   - The lock. The person stays signed in; when the app is opened from
//     closed, or comes back after LOCK_AFTER_MS in the background, the screen
//     is covered (AppLockScreen) until Face ID passes. "Usar contraseña"
//     instead is a normal sign-in.
//   - Getting back in without the password. The session's refresh token is
//     kept in the Keychain / Android Keystore (this device only, never in a
//     backup), and the sign-in screen offers "Entrar con Face ID" when the
//     app has lost its session but not that -- after a reinstall, or iOS
//     clearing the WebView's storage. A session restored that way keeps the
//     two-factor level it was created with: Face ID protects the device, it
//     does not stand in for the account's second factor.
//
// Signing out forgets all of it, on purpose: a clinic iPad is shared, and
// whoever signs out must leave nothing behind for the next person. So does
// "Usar contraseña" from the lock, for the same reason.
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'

/** Two hours away, then Face ID again (decided 9 Oct 2026; banks use minutes). */
export const LOCK_AFTER_MS = 2 * 60 * 60 * 1000

const TOKEN_KEY = 'faceid_refresh_token'
const BACKGROUND_KEY = 'faceid_backgrounded_at'
const OFFERED_PREFIX = 'faceid_offered:'

export type Biometry = 'faceId' | 'touchId' | 'other'

const locked = ref(false)
const enabled = ref(false)
const biometry = ref<Biometry | null>(null)
const ready = ref(false)
let storageConfigured = false

function isNative() {
  return import.meta.client && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}

// Configures the store once; callers then use SecureStorage directly. It is
// deliberately not returned from here: a Capacitor plugin proxy answers every
// property, `then` included, so an async function returning it is taken for a
// promise and awaited forever -- which is what left the app a white screen.
async function configureStorage() {
  if (storageConfigured) return
  storageConfigured = true
  // Never in iCloud Keychain, never restored onto another device.
  await SecureStorage.setSynchronize(false)
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
}

export function useAppLock() {
  const t = useT()
  const supabase = useSupabaseClient()

  /** "Face ID", "Touch ID" or the fingerprint -- what to call it on screen. */
  const label = computed(() => (biometry.value === 'faceId' ? 'Face ID' : biometry.value === 'touchId' ? 'Touch ID' : t('fingerprint', 'huella')))

  /** Reads whether the device has biometry and whether a sign-in is kept. Once per app run. */
  async function init() {
    if (ready.value || !isNative()) {
      ready.value = true
      return
    }
    try {
      const r = await BiometricAuth.checkBiometry()
      // BiometryType: 1 touchId, 2 faceId on iOS; Android reports its own kinds.
      biometry.value = r.isAvailable ? (r.biometryType === 2 ? 'faceId' : r.biometryType === 1 ? 'touchId' : 'other') : null
    } catch {
      biometry.value = null
    }
    try {
      await configureStorage()
      enabled.value = !!(await SecureStorage.get(TOKEN_KEY))
    } catch {
      enabled.value = false
    }
    ready.value = true
  }

  async function confirm(reason: string): Promise<boolean> {
    try {
      // The phone's passcode as the fallback, as banking apps allow: Face ID
      // fails in the dark, with a mask, after a few misses.
      await BiometricAuth.authenticate({ reason, cancelTitle: t('Cancel', 'Cancelar'), allowDeviceCredential: true, androidTitle: 'QuiroFlow' })
      return true
    } catch {
      return false
    }
  }

  /** Keeps the latest refresh token, so a restored session is never a revoked one. */
  async function keep(refreshToken: string | null | undefined): Promise<boolean> {
    if (!enabled.value || !refreshToken) return false
    try {
      await configureStorage()
      await SecureStorage.set(TOKEN_KEY, refreshToken)
      return true
    } catch {
      return false
    }
  }

  async function enable(): Promise<boolean> {
    if (!biometry.value) return false
    const ok = await confirm(t(`Use ${label.value} to open QuiroFlow`, `Usar ${label.value} para abrir QuiroFlow`))
    if (!ok) return false
    const { data } = await supabase.auth.getSession()
    enabled.value = true
    // Whether it is on is whether the Keychain holds the sign-in: if it
    // refused, saying "on" would be true only until the app is next opened.
    if (!(await keep(data.session?.refresh_token))) {
      enabled.value = false
      return false
    }
    return true
  }

  /** Switches it off and forgets the kept sign-in. Also what signing out does. */
  async function forget() {
    enabled.value = false
    locked.value = false
    try {
      await configureStorage()
      await SecureStorage.remove(TOKEN_KEY)
    } catch {
      // Nothing kept.
    }
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(OFFERED_PREFIX)) localStorage.removeItem(k)
      localStorage.removeItem(BACKGROUND_KEY)
    } catch {
      // Storage blocked.
    }
  }

  async function unlock(): Promise<boolean> {
    const ok = await confirm(t('Unlock QuiroFlow', 'Desbloquear QuiroFlow'))
    if (ok) locked.value = false
    return ok
  }

  /** The sign-in screen's "Entrar con Face ID": the kept session back, after Face ID. */
  async function signIn(): Promise<'ok' | 'cancelled' | 'expired'> {
    const ok = await confirm(t('Sign in to QuiroFlow', 'Entrar en QuiroFlow'))
    if (!ok) return 'cancelled'
    let token: string | null = null
    try {
      await configureStorage()
      token = ((await SecureStorage.get(TOKEN_KEY)) as string | null) ?? null
    } catch {
      token = null
    }
    if (!token) {
      await forget()
      return 'expired'
    }
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: token })
    if (error || !data.session) {
      // Signed out elsewhere ("Cerrar las demás") or revoked: the password it is.
      await forget()
      return 'expired'
    }
    enabled.value = true
    locked.value = false
    await keep(data.session.refresh_token)
    return 'ok'
  }

  // -- The lock ----------------------------------------------------------------
  function backgrounded() {
    try {
      localStorage.setItem(BACKGROUND_KEY, String(Date.now()))
    } catch {
      // Storage blocked: the next resume locks, which errs the safe way.
    }
  }
  async function resumed() {
    if (!enabled.value) return
    let at = 0
    try {
      at = Number(localStorage.getItem(BACKGROUND_KEY) ?? 0)
    } catch {
      at = 0
    }
    if (!at || Date.now() - at >= LOCK_AFTER_MS) await lockIfSignedIn()
  }
  async function lockIfSignedIn() {
    if (!enabled.value) return
    const { data } = await supabase.auth.getSession()
    if (data.session) locked.value = true
  }

  // -- The offer after signing in ------------------------------------------------
  function offered(userId: string) {
    try {
      return localStorage.getItem(OFFERED_PREFIX + userId) === '1'
    } catch {
      return true
    }
  }
  function markOffered(userId: string) {
    try {
      localStorage.setItem(OFFERED_PREFIX + userId, '1')
    } catch {
      // Asked again next time; harmless.
    }
  }

  return {
    locked: readonly(locked),
    enabled: readonly(enabled),
    biometry: readonly(biometry),
    ready: readonly(ready),
    label,
    native: isNative,
    init,
    enable,
    forget,
    unlock,
    signIn,
    keep,
    backgrounded,
    resumed,
    lockIfSignedIn,
    offered,
    markOffered,
  }
}
