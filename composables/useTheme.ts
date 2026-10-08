import type { Ref } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'quiroflow-theme'
const STATE_KEY = 'theme-preference'
const DEFAULT: ThemePreference = 'system'
// The device's own appearance. Only ever set on the client (initFromStorage),
// so file scope is the right scope for it: the server leaves it false.
const systemDark = ref(false)
let initialized = false

// Per request on the server, from the payload on the client -- see
// preferenceState in useLang.ts, which this mirrors: a file-scope ref here
// was shared by every request in the server process, so one staff member's
// saved theme leaked into the next request's render.
function preferenceState(): Ref<ThemePreference | null> {
  if (tryUseNuxtApp()) return useState<ThemePreference | null>(STATE_KEY, () => null)
  if (import.meta.dev && import.meta.server) {
    console.warn('[useTheme] called outside a Nuxt context on the server; using the default theme. Call useTheme() before the first await.')
  }
  return ref(null)
}

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

function apply(pref: ThemePreference) {
  if (import.meta.server) return
  const resolved = resolve(pref)
  document.documentElement.setAttribute('data-theme', resolved)
  applyThemeColor(resolved)
}

// Applied as early as possible (a client-only plugin calls this on boot) so
// the page never flashes the wrong theme -- localStorage is read
// synchronously before the account store's DB round-trip resolves.
//
// A preference the server already resolved (a signed-in staff member's
// saved one, carried in the payload) wins over this device's stored one, and
// is stored -- same as useLang's initFromStorage.
function initFromStorage() {
  if (initialized || import.meta.server) return
  initialized = true
  const state = preferenceState()
  if (state.value) {
    localStorage.setItem(STORAGE_KEY, state.value)
  } else {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') state.value = stored
  }
  systemDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemDark.value = e.matches
    apply(state.value ?? DEFAULT)
  })
  apply(state.value ?? DEFAULT)
}

export function useTheme() {
  const state = preferenceState()

  function setPreference(pref: ThemePreference) {
    state.value = pref
    if (!import.meta.server) localStorage.setItem(STORAGE_KEY, pref)
    apply(pref)
  }

  return {
    preference: computed(() => state.value ?? DEFAULT),
    resolved: computed(() => resolve(state.value ?? DEFAULT)),
    setPreference,
    initFromStorage,
  }
}
