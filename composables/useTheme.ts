export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'quiroflow-theme'
const preference = ref<ThemePreference>('system')
let systemDark = ref(false)
let initialized = false

function resolve(pref: ThemePreference) {
  return pref === 'system' ? (systemDark.value ? 'dark' : 'light') : pref
}

function apply() {
  if (import.meta.server) return
  document.documentElement.setAttribute('data-theme', resolve(preference.value))
}

// Applied as early as possible (a client-only plugin calls this on boot) so
// the page never flashes the wrong theme -- localStorage is read
// synchronously before the account store's DB round-trip resolves.
function initFromStorage() {
  if (initialized || import.meta.server) return
  initialized = true
  const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
  if (stored === 'light' || stored === 'dark' || stored === 'system') preference.value = stored
  systemDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemDark.value = e.matches
    apply()
  })
  apply()
}

export function useTheme() {
  function setPreference(pref: ThemePreference) {
    preference.value = pref
    if (!import.meta.server) localStorage.setItem(STORAGE_KEY, pref)
    apply()
  }

  return {
    preference: computed(() => preference.value),
    resolved: computed(() => resolve(preference.value)),
    setPreference,
    initFromStorage,
  }
}
