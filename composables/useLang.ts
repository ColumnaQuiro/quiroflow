import type { Ref } from 'vue'

export type LanguagePreference = 'en' | 'es'

const STORAGE_KEY = 'quiroflow-lang'
const STATE_KEY = 'lang-preference'
const DEFAULT: LanguagePreference = 'en'
let initialized = false

// The preference lives in useState, not in a ref at file scope. On the
// server this module is loaded once per process and shared by every request
// in it, so a file-scope ref set by one staff member's bootstrap was what the
// next request rendered in -- a patient opening /book or /portal got the
// language of whoever had signed in last on that warm function, and the
// client then flipped it on hydration. useState belongs to the Nuxt app,
// which the server creates per request, and the client picks up the server's
// value from the payload.
//
// null means "nobody has resolved it": nothing signed in on the server, and
// no stored choice applied yet on the client. It reads as DEFAULT.
//
// Outside a Nuxt context there is no app to hang it on. On the server that
// means after an await -- resolve useLang()/useT() before the first one --
// and rather than fail the render, it gets a ref of its own: English, and
// never shared with another request.
function preferenceState(): Ref<LanguagePreference | null> {
  if (tryUseNuxtApp()) return useState<LanguagePreference | null>(STATE_KEY, () => null)
  if (import.meta.dev && import.meta.server) {
    console.warn('[useLang] called outside a Nuxt context on the server; rendering in the default language. Call useLang()/useT() before the first await.')
  }
  return ref(null)
}

// Applied as early as possible (a client-only plugin calls this on boot),
// same reasoning as useTheme's initFromStorage -- localStorage is read
// synchronously before the account store's DB round-trip resolves the
// real per-user preference, so returning staff don't see a flash of
// English before switching to Spanish.
//
// When the server already resolved it -- a signed-in staff member's saved
// preference, which the payload carries -- that wins over what this device
// last stored: it is the real one, it is what the HTML was rendered in, and
// the account store does not load again on the client to re-apply it. It is
// stored, so the next client-only page starts from it too.
//
// `fallback` is what to show when nothing has been stored: the staff app
// passes the device's language there (mobile/plugins/lang.client.ts), since
// it has no account store to resolve a preference from. It is applied, not
// stored, so a later choice still wins and a device language change is
// still followed.
function initFromStorage(fallback?: LanguagePreference) {
  if (initialized || import.meta.server) return
  initialized = true
  const state = preferenceState()
  if (state.value) {
    writeStorage(state.value)
    return
  }
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  if (stored === 'en' || stored === 'es') state.value = stored
  else if (fallback) state.value = fallback
}

function writeStorage(pref: LanguagePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // As above.
  }
}

export function useLang() {
  const state = preferenceState()

  function setPreference(pref: LanguagePreference) {
    state.value = pref
    if (!import.meta.server) writeStorage(pref)
  }

  return {
    preference: computed(() => state.value ?? DEFAULT),
    setPreference,
    initFromStorage,
  }
}
