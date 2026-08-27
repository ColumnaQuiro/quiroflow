// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // mobile/ is its own separate Nuxt project (own pages/node_modules) plus
  // native iOS/Android build output -- tens of thousands of files this app
  // has no reason to scan or watch, and watching them blows past macOS's
  // per-process open-file limit (EMFILE) once CocoaPods/Gradle populate
  // mobile/ios and mobile/android.
  ignore: ['mobile/**'],
  css: ['~/assets/css/theme.css'],
  app: {
    head: {
      // The whole app currently lives on app.quiroflow.com -- there's no
      // separate marketing site yet, so nothing here should be indexed.
      // robots.txt alone doesn't stop a page Google discovers via an
      // external link from being indexed; this tag is the actual guarantee.
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'alternate icon', href: '/favicon.ico' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400&family=JetBrains+Mono:wght@400;500&display=swap',
        },
      ],
    },
  },
  nitro: {
    preset: 'netlify',
  },
  routeRules: {
    // The calendar's initial render depends on "today"/"now" (mini-calendar
    // highlight, current-time line, default date range), which differ
    // between the server's timezone and the visitor's -- causing a
    // hydration mismatch once or twice a day whenever the two disagree on
    // the calendar date. No SEO benefit to SSR here (authenticated app),
    // so it's simplest to render this route client-side only.
    '/calendar': { ssr: false },
  },
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase', '@pinia/nuxt'],
  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/', '/login', '/signup', '/confirm', '/join', '/portal/**', '/book/**', '/forgot-password', '/reset-password', '/legal/**'],
    },
  },
  runtimeConfig: {
    resendApiKey: '',
    // Used to auto-register a new clinic's booking subdomain as a Netlify
    // domain alias on sign-up. Optional -- if unset (e.g. local dev), the
    // registration call just no-ops and the subdomain can be added
    // manually later, same as before this existed.
    netlifyAuthToken: '',
    netlifySiteId: '',
    // Platform-level Stripe account used for Connect: clinics authorize via
    // OAuth instead of pasting their own API keys, and every connected
    // account's webhook events land on one shared endpoint. Optional -- if
    // unset, Settings > Payments falls back to the legacy manual-key flow.
    stripeSecretKey: '',
    stripeConnectWebhookSecret: '',
    // Firebase service-account key (JSON, as a single-line string) for
    // sending mobile push notifications via FCM v1. Optional -- if unset,
    // server/utils/pushNotifications.ts just no-ops, same as WhatsApp
    // delivery tracking being optional when unconfigured.
    fcmServiceAccountJson: '',
    // Shared secret checked by server/api/automations/birthday-cron.post.ts
    // -- that endpoint is called by a Postgres pg_cron job (via pg_net),
    // which carries no session, so this stands in for auth on that one
    // request. Optional -- if unset, the endpoint just always rejects.
    cronSecret: '',
    public: {
      // Booking subdomains: <account-slug>.<appDomain> gets rewritten to
      // /book/<account-slug> by server/middleware/subdomain-booking.ts.
      // Defaults to localtest.me (public DNS -> 127.0.0.1) so this works
      // in local dev with no /etc/hosts changes -- set this to your real
      // domain once QuiroFlow is deployed somewhere with wildcard DNS.
      appDomain: 'localtest.me',
      // Connect "client ID" (ca_...) from Stripe Dashboard > Connect >
      // Settings -- not a secret, it's meant to sit in a redirect URL.
      stripeConnectClientId: '',
      // Firebase web app config + VAPID key, for browser push notifications
      // (composables/useWebPush.ts). Not secrets -- Firebase's own docs have
      // these shipped in the client bundle; the actual security boundary is
      // Firestore/RTDB rules and the FCM send-side service account, neither
      // of which this config exposes. Registered as the "QuiroFlow Web" app
      // in the same Firebase project mobile push already uses, so both land
      // in the one device_push_tokens table server/utils/pushNotifications.ts
      // already sends to.
      firebaseWebConfig: {
        apiKey: 'AIzaSyAxzrb1SFgtc5yFgvlIc5w1NJFTKMUaJLA',
        authDomain: 'quiroflow-b3a5b.firebaseapp.com',
        projectId: 'quiroflow-b3a5b',
        storageBucket: 'quiroflow-b3a5b.firebasestorage.app',
        messagingSenderId: '972446092693',
        appId: '1:972446092693:web:01dcbf0f547de4ba803a9c',
      },
      firebaseVapidKey: 'BGeaAYWoNrfHHHE4g9lLol7Ae8mq8H_RktEKFzQiZvNF-9ILLDjkmEYrDnJMS-d4BDwf2Wu6PeynXlamrrYbNO8',
    },
  },
  // Vite's dev server rejects unrecognized Host headers by default; allow
  // booking subdomains through so *.localtest.me works without extra setup.
  vite: {
    server: {
      allowedHosts: ['.localtest.me'],
      watch: {
        ignored: ['**/mobile/**'],
      },
    },
  },
})
