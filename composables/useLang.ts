export type LanguagePreference = 'en' | 'es'

const STORAGE_KEY = 'quiroflow-lang'
const preference = ref<LanguagePreference>('en')
let initialized = false

// Applied as early as possible (a client-only plugin calls this on boot),
// same reasoning as useTheme's initFromStorage -- localStorage is read
// synchronously before the account store's DB round-trip resolves the
// real per-user preference, so returning staff don't see a flash of
// English before switching to Spanish.
//
// `fallback` is what to show when nothing has been stored: the staff app
// passes the device's language there (mobile/plugins/lang.client.ts), since
// it has no account store to resolve a preference from. It is applied, not
// stored, so a later choice still wins and a device language change is
// still followed.
function initFromStorage(fallback?: LanguagePreference) {
  if (initialized || import.meta.server) return
  initialized = true
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  if (stored === 'en' || stored === 'es') preference.value = stored
  else if (fallback) preference.value = fallback
}

export function useLang() {
  function setPreference(pref: LanguagePreference) {
    preference.value = pref
    if (!import.meta.server) localStorage.setItem(STORAGE_KEY, pref)
  }

  return {
    preference: computed(() => preference.value),
    setPreference,
    initFromStorage,
  }
}
