// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'alternate icon', href: '/favicon.ico' },
      ],
    },
  },
  nitro: {
    preset: 'netlify',
  },
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase', '@pinia/nuxt'],
  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/', '/login', '/signup', '/confirm', '/join', '/portal/**', '/book/**', '/forgot-password', '/reset-password'],
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
    },
  },
  // Vite's dev server rejects unrecognized Host headers by default; allow
  // booking subdomains through so *.localtest.me works without extra setup.
  vite: {
    server: {
      allowedHosts: ['.localtest.me'],
    },
  },
})
