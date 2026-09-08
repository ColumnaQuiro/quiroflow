export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'quiroflow-theme'
const preference = ref<ThemePreference>('system')
let systemDark = ref(false)
let initialized = false

function resolve(pref: ThemePreference) {
  return pref === 'system' ? (systemDark.value ? 'dark' : 'light') : pref
}

// Keeps iOS/Android's browser-chrome tint (status bar, bottom toolbar)
// matching the page instead of the default gray -- the two static
// `theme-color` tags in nuxt.config.ts only cover "system", so a manually
// picked Settings > Appearance preference needs the actual tag's content
// updated here too. Values mirror --color-surface-page in theme.css.
const THEME_COLOR: Record<'light' | 'dark', string> = { light: '#F7F8FA', dark: '#0F1014' }
export function applyThemeColor(theme: 'light' | 'dark') {
  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.setAttribute('content', THEME_COLOR[theme]))
}

function apply() {
  if (import.meta.server) return
  const resolved = resolve(preference.value)
  document.documentElement.setAttribute('data-theme', resolved)
  applyThemeColor(resolved)
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
