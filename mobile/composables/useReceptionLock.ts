// Reception mode: the iPad handed to one patient to fill in and sign their
// pending forms, with nothing else of the clinic reachable until a member of
// the team takes it back.
//
// The lock lives in localStorage, not in memory, so it outlasts what a
// patient can do to the app: reloading the WebView, or closing the app and
// opening it again, lands back on the forms (middleware/reception.global.ts),
// not on the clinic's day. Closing the app at all is iOS's business --
// Guided Access is what stops that, and the setup sheet says so.
//
// Leaving needs either the device's owner (Face ID / Touch ID, through
// @aparajita/capacitor-biometric-auth: on a clinic iPad, the team) or the
// reception code. The code belongs to this device: chosen the first time
// reception mode is used here and stored only as a salted SHA-256, so
// reading localStorage does not give it away. Forgotten, the signed-in team
// member's password opens it as well (ReceptionExit).
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'

const LOCK_KEY = 'reception_lock'
const CODE_KEY = 'reception_code'

export interface ReceptionLock {
  patientId: string
  /** For "Hola, Marcos" -- kept here so the forms never need the staff session. */
  firstName: string
  clinicName: string
  /**
   * The forms, in order, by their public token: they are filled in through
   * the same get/save_public_patient_doc the patient's own link uses, so a
   * form signed here is stored exactly as one signed from that link.
   */
  tokens: string[]
  /** Who handed the iPad over: their password also opens it. */
  staffEmail: string
  startedAt: string
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

async function sha256(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function useReceptionLock() {
  function current(): ReceptionLock | null {
    return read<ReceptionLock>(LOCK_KEY)
  }
  function lock(state: Omit<ReceptionLock, 'startedAt'>) {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ ...state, startedAt: new Date().toISOString() }))
  }
  function unlock() {
    localStorage.removeItem(LOCK_KEY)
  }

  function hasCode() {
    return !!read<{ salt: string; hash: string }>(CODE_KEY)
  }
  async function setCode(code: string) {
    const salt = crypto.randomUUID()
    localStorage.setItem(CODE_KEY, JSON.stringify({ salt, hash: await sha256(`${salt}:${code}`) }))
  }
  async function checkCode(code: string) {
    const stored = read<{ salt: string; hash: string }>(CODE_KEY)
    return !!stored && (await sha256(`${stored.salt}:${code}`)) === stored.hash
  }

  /** 'faceId', 'touchId' or another biometry the device offers; null in a browser or without one enrolled. */
  async function biometry(): Promise<'faceId' | 'touchId' | 'other' | null> {
    try {
      const r = await BiometricAuth.checkBiometry()
      if (!r.isAvailable) return null
      // BiometryType: 1 touchId, 2 faceId (iOS); Android reports its own kinds.
      return r.biometryType === 2 ? 'faceId' : r.biometryType === 1 ? 'touchId' : 'other'
    } catch {
      return null
    }
  }
  async function confirmWithBiometry(reason: string) {
    try {
      await BiometricAuth.authenticate({ reason, cancelTitle: 'Cancelar', allowDeviceCredential: false, iosFallbackTitle: '' })
      return true
    } catch {
      return false
    }
  }

  // Wrong codes are counted on the device, not in the exit sheet: the sheet
  // is rebuilt each time it opens, so closing and reopening it used to reset
  // the count and the 30-second wait never stopped anyone.
  const ATTEMPTS_KEY = 'reception_code_attempts'
  function attempts(): { failures: number; waitUntil: number } {
    return read<{ failures: number; waitUntil: number }>(ATTEMPTS_KEY) ?? { failures: 0, waitUntil: 0 }
  }
  function recordFailure() {
    const a = attempts()
    a.failures++
    // Every fifth miss waits, and each wait doubles (30 s, 1 min, 2 min… up
    // to 15 min): ten thousand four-digit codes stop being a pastime.
    if (a.failures % 5 === 0) a.waitUntil = Date.now() + Math.min(15 * 60000, 30000 * 2 ** (a.failures / 5 - 1))
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a))
  }
  function clearFailures() {
    localStorage.removeItem(ATTEMPTS_KEY)
  }

  return { current, lock, unlock, hasCode, setCode, checkCode, biometry, confirmWithBiometry, attempts, recordFailure, clearFailures }
}
