import { fileURLToPath } from 'node:url'

// Not a Nuxt layer extending the main app -- that would pull in all of its
// 57 staff-desktop pages into this bundle. Instead this is its own small
// Nuxt project with its own pages/, wired to reuse the main app's
// components/composables/utils/stores by pointing at them directly, and its
// own Tailwind config that imports the shared design tokens.
const root = fileURLToPath(new URL('..', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false, // runs inside a Capacitor WebView, not a Node server
  devtools: { enabled: false }, // its floating panel gets in the way of a phone-width layout
  app: {
    head: {
      // viewport-fit=cover lets content go edge-to-edge under the notch/home
      // indicator -- paired with safe-area padding in app.vue so it doesn't
      // collide with the status bar instead.
      //
      // maximum-scale=1, user-scalable=no: without this, WKWebView can
      // auto-zoom the page in response to certain focus/layout changes
      // (confirmed live via Safari Web Inspector -- visualViewport.scale
      // was stuck at ~1.14 after a sign-in transition, which is what made
      // right-aligned content clip past the visible edge) and doesn't
      // reliably reset the scale back to 1 afterwards. Locking the max
      // scale makes that whole bug class impossible rather than working
      // around one trigger for it.
      viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
    },
  },
  runtimeConfig: {
    public: {
      // The app's own server routes (/api/**) don't exist inside the mobile
      // bundle -- it's a static Capacitor build with no Nitro server on
      // device, only the pages/assets themselves. useAuthedFetch.ts uses
      // this to turn every relative '/api/...' call into an absolute one
      // against the real deployment, since a relative fetch from a
      // capacitor://localhost origin was silently resolving nowhere.
      apiBase: 'https://app.quiroflow.com',
    },
  },
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase'],
  // theme.css is what actually sets the --color-brand/--color-ink/etc custom
  // properties tailwind.config.ts's colors resolve through (rgb(var(--color-x))) --
  // without it every bg-brand/text-brand-text/border-line-control class
  // computes to an invalid rgb(var(--undefined)) value the browser silently
  // drops, rendering as plain black/white with no brand color at all.
  css: [`${root}/assets/css/theme.css`, '~/assets/css/main.css'],
  components: [`${root}/components`, '~/components'],
  imports: {
    dirs: [`${root}/composables`, `${root}/utils`],
  },
  supabase: {
    types: `${root}/types/database.types.ts`,
    // Session goes in localStorage, not a cookie -- see requirePermission.ts
    // for the matching server-side bearer-token path this pairs with.
    useSsrCookies: false,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login', '/signup', '/join'],
    },
  },
})
