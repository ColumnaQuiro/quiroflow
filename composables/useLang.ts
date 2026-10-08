import type { Ref } from 'vue'

export type LanguagePreference = 'en' | 'es'

const STORAGE_KEY = 'quiroflow-lang'
// The stored choice is mirrored into a cookie of the same name, because the
// server cannot read localStorage -- see requestLanguage below.
const COOKIE_KEY = STORAGE_KEY
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const STATE_KEY = 'lang-preference'
const REQUEST_STATE_KEY = 'lang-request-default'
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
// no stored choice applied yet on the client. It then reads as the
// request's own default (requestDefaultState), and failing that as DEFAULT.
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

// What the server renders in for someone it has no saved preference for --
// the language the client is about to pick for them, so that the page does
// not render in English and switch to Spanish as it hydrates.
//
// Kept apart from preferenceState on purpose: a value there means "this
// person's saved preference, store it on the device", and a guess from
// request headers is not a choice anyone made. The client ignores this one
// and decides for itself (initFromStorage); the two agree because they ask
// the same questions in the same order.
//
// Resolved once per request (useState runs its initializer once), not on
// every useT() call.
function requestDefaultState(): Ref<LanguagePreference | null> {
  if (!tryUseNuxtApp()) return ref(null)
  return useState<LanguagePreference | null>(REQUEST_STATE_KEY, () => (import.meta.server ? requestLanguage() : null))
}

// The server's view of what initFromStorage will pick: the choice stored on
// this device (as its cookie), else the browser's language (Accept-Language,
// the header built from the same list navigator.languages reads).
function requestLanguage(): LanguagePreference {
  const stored = useCookie<string | null>(COOKIE_KEY, { readonly: true }).value
  if (stored === 'en' || stored === 'es') return stored
  return languageFromAcceptLanguage(useRequestHeader('accept-language'))
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
// `fallback` is what to show when nothing has been stored: the browser's or
// device's language, which both plugins pass. It is applied, not stored, so
// a later choice still wins and a language change on the device is still
// followed.
//
// The cookie is brought in line with what is stored either way: set for a
// choice made before it existed, cleared when there is no choice -- so the
// server falls back to the browser's language exactly when this does.
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
  if (stored === 'en' || stored === 'es') {
    state.value = stored
    writeCookie(stored)
  } else {
    writeCookie(null)
    if (fallback) state.value = fallback
  }
}

function writeStorage(pref: LanguagePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // As above.
  }
  writeCookie(pref)
}

// Written directly rather than through useCookie: this runs from click
// handlers and from the plugin alike, and only needs to set one string.
function writeCookie(pref: LanguagePreference | null) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = pref
      ? `${COOKIE_KEY}=${pref}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
      : `${COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
  } catch {
    // No document cookies (sandboxed frame): the server falls back to the
    // browser's language, which is where it was before the cookie existed.
  }
}

export function useLang() {
  const state = preferenceState()
  const requestDefault = requestDefaultState()

  function setPreference(pref: LanguagePreference) {
    state.value = pref
    if (!import.meta.server) writeStorage(pref)
  }

  return {
    preference: computed(() => state.value ?? requestDefault.value ?? DEFAULT),
    setPreference,
    initFromStorage,
  }
}
