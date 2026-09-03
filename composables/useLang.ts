export type LanguagePreference = 'en' | 'es'

const STORAGE_KEY = 'quiroflow-lang'
const preference = ref<LanguagePreference>('en')
let initialized = false

// Applied as early as possible (a client-only plugin calls this on boot),
// same reasoning as useTheme's initFromStorage -- localStorage is read
// synchronously before the account store's DB round-trip resolves the
// real per-user preference, so returning staff don't see a flash of
// English before switching to Spanish.
function initFromStorage() {
  if (initialized || import.meta.server) return
  initialized = true
  const stored = localStorage.getItem(STORAGE_KEY) as LanguagePreference | null
  if (stored === 'en' || stored === 'es') preference.value = stored
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
