import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, computed, type Ref } from 'vue'

// The language and theme a page renders in belong to the request rendering
// it, not to the server process.
//
// They used to be refs at file scope in composables/useLang.ts and
// useTheme.ts. On the server that module is loaded once and shared by every
// request, so the account store setting a staff member's language during
// SSR set it for the NEXT request too -- a patient opening a booking page
// got the language of whoever had last signed in on that warm function.
//
// These composables use Nuxt's auto-imports, which do not exist under
// Vitest, so the four they need are stubbed: vue's own ref/computed, and a
// useState that, like Nuxt's, keeps its state on the current app. Each
// "request" here is a separate fake app, which is what Nuxt creates per
// request on the server.
type FakeApp = { state: Record<string, Ref<unknown>> }
let currentApp: FakeApp | null = null

function newApp(state: Record<string, unknown> = {}): FakeApp {
  return { state: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, ref(v)])) }
}

function inApp<T>(app: FakeApp | null, fn: () => T): T {
  const previous = currentApp
  currentApp = app
  try {
    return fn()
  } finally {
    currentApp = previous
  }
}

const storage = new Map<string, string>()

beforeEach(() => {
  vi.resetModules()
  storage.clear()
  currentApp = null
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('tryUseNuxtApp', () => currentApp)
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!currentApp) throw new Error('useState outside a Nuxt app')
    currentApp.state[key] ??= ref(init())
    return currentApp.state[key]
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function loadLang() {
  return (await import('../../composables/useLang')).useLang
}

async function loadTheme() {
  return (await import('../../composables/useTheme')).useTheme
}

describe('Language is per request', () => {
  it("does not carry one request's language into the next", async () => {
    const useLang = await loadLang()
    const staffRequest = newApp()
    const patientRequest = newApp()

    // A staff member's bootstrap applies their saved language...
    inApp(staffRequest, () => useLang().setPreference('es'))
    expect(inApp(staffRequest, () => useLang().preference.value)).to.eq('es')

    // ...and the next request, which sets nothing, renders in the default.
    expect(inApp(patientRequest, () => useLang().preference.value)).to.eq('en')
  })

  it('keeps two requests apart while both are rendering', async () => {
    const useLang = await loadLang()
    const a = newApp()
    const b = newApp()

    // Resolved up front, the way a component's setup does, then read later.
    const langA = inApp(a, () => useLang())
    const langB = inApp(b, () => useLang())
    langA.setPreference('es')
    langB.setPreference('en')

    expect(langA.preference.value).to.eq('es')
    expect(langB.preference.value).to.eq('en')
  })

  it('outside a Nuxt context, uses the default and shares nothing', async () => {
    const useLang = await loadLang()
    inApp(null, () => useLang().setPreference('es'))
    expect(inApp(null, () => useLang().preference.value)).to.eq('en')
  })
})

describe('Language on the client', () => {
  it("keeps the language the server resolved, over this device's stored one", async () => {
    const useLang = await loadLang()
    storage.set('quiroflow-lang', 'en')
    // The payload carries the signed-in staff member's saved language.
    const app = newApp({ 'lang-preference': 'es' })

    inApp(app, () => useLang().initFromStorage('en'))

    expect(inApp(app, () => useLang().preference.value)).to.eq('es')
    expect(storage.get('quiroflow-lang'), 'stored for the next client-only page').to.eq('es')
  })

  it('applies the stored language when the server resolved none', async () => {
    const useLang = await loadLang()
    storage.set('quiroflow-lang', 'es')
    const app = newApp({ 'lang-preference': null })

    inApp(app, () => useLang().initFromStorage('en'))

    expect(inApp(app, () => useLang().preference.value)).to.eq('es')
  })

  it('falls back to the given language with nothing stored, without storing it', async () => {
    const useLang = await loadLang()
    const app = newApp()

    inApp(app, () => useLang().initFromStorage('es'))

    expect(inApp(app, () => useLang().preference.value)).to.eq('es')
    expect(storage.has('quiroflow-lang')).to.eq(false)
  })
})

describe("A visitor nobody has resolved", () => {
  // The server's guess from the request (cookie, then Accept-Language) is
  // kept in its own state, so a signed-in preference still wins over it.
  it("renders in the request's language, and a saved preference wins over it", async () => {
    const useLang = await loadLang()
    const anonymous = newApp({ 'lang-request-default': 'es' })
    expect(inApp(anonymous, () => useLang().preference.value)).to.eq('es')

    const staff = newApp({ 'lang-request-default': 'es' })
    inApp(staff, () => useLang().setPreference('en'))
    expect(inApp(staff, () => useLang().preference.value)).to.eq('en')
  })

  it("does not store the server's guess on the device as if it were a choice", async () => {
    const useLang = await loadLang()
    const app = newApp({ 'lang-preference': null, 'lang-request-default': 'es' })

    inApp(app, () => useLang().initFromStorage('es'))

    expect(inApp(app, () => useLang().preference.value)).to.eq('es')
    expect(storage.has('quiroflow-lang')).to.eq(false)
  })
})

describe('The stored choice is mirrored into a cookie the server can read', () => {
  let cookieWrites: string[]

  beforeEach(() => {
    cookieWrites = []
    vi.stubGlobal('location', { protocol: 'https:' })
    vi.stubGlobal('document', {
      set cookie(value: string) {
        cookieWrites.push(value)
      },
    })
  })

  it('sets it when a language is chosen', async () => {
    const useLang = await loadLang()
    inApp(newApp(), () => useLang().setPreference('es'))
    expect(cookieWrites.at(-1)).to.match(/^quiroflow-lang=es; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/)
  })

  it('sets it on boot for a choice stored before the cookie existed', async () => {
    const useLang = await loadLang()
    storage.set('quiroflow-lang', 'es')
    inApp(newApp(), () => useLang().initFromStorage('en'))
    expect(cookieWrites.at(-1)).to.match(/^quiroflow-lang=es;/)
  })

  it('clears it on boot when nothing is stored, so the server goes by the browser too', async () => {
    const useLang = await loadLang()
    inApp(newApp(), () => useLang().initFromStorage('es'))
    expect(cookieWrites.at(-1)).to.match(/^quiroflow-lang=; .*Max-Age=0/)
  })

  it("sets it to a signed-in staff member's saved language", async () => {
    const useLang = await loadLang()
    storage.set('quiroflow-lang', 'en')
    inApp(newApp({ 'lang-preference': 'es' }), () => useLang().initFromStorage('en'))
    expect(cookieWrites.at(-1)).to.match(/^quiroflow-lang=es;/)
  })
})

describe('Theme is per request', () => {
  it("does not carry one request's theme into the next", async () => {
    const useTheme = await loadTheme()
    // apply() touches the document on the client; give it one to touch.
    vi.stubGlobal('document', {
      documentElement: { setAttribute: () => {} },
      querySelectorAll: () => [],
    })
    const staffRequest = newApp()
    const patientRequest = newApp()

    inApp(staffRequest, () => useTheme().setPreference('dark'))

    expect(inApp(staffRequest, () => useTheme().preference.value)).to.eq('dark')
    expect(inApp(patientRequest, () => useTheme().preference.value)).to.eq('system')
  })
})
