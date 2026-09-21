import { DEV_PORTAL_SLUGS } from './utils/devPortal'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // mobile/ is its own separate Nuxt project (own pages/node_modules) plus
  // native iOS/Android build output -- tens of thousands of files this app
  // has no reason to scan or watch, and watching them blows past macOS's
  // per-process open-file limit (EMFILE) once CocoaPods/Gradle populate
  // mobile/ios and mobile/android.
  //
  // .claude/worktrees/ holds agent git worktrees -- each one a full checkout
  // of this repo, node_modules and mobile/ios asset catalogs included, so a
  // couple of them are already more files than the rest of the tree put
  // together. Watching them hits that same EMFILE ceiling: `npm run dev`
  // dies on a flood of `EMFILE: too many open files, watch '...'` before it
  // ever finishes booting. They're checked out inside the repo so that
  // `git worktree list` and the agent tooling can find them, which is
  // exactly why they have to be excluded here by hand.
  ignore: ['mobile/**', '.claude/worktrees/**', 'cypress/screenshots/**', 'cypress/videos/**', 'cypress/downloads/**'],
  css: ['~/assets/css/theme.css'],
  app: {
    head: {
      // The whole app currently lives on app.quiroflow.com -- there's no
      // separate marketing site yet, so nothing here should be indexed.
      //
      // This tag is a backstop, not the guarantee it was once described as:
      // it only works if the crawler fetches the page, and while robots.txt
      // said `Disallow: /` no crawler ever did -- which is how the login page
      // sat in Google with a noindex tag it had never read. The directive
      // that does the work is the X-Robots-Tag header
      // (server/middleware/noindex.ts). The tag stays because it costs
      // nothing and covers a fetch that somehow skips the header.
      //
      // The developer portal's own pages override it with `index, follow`.
      meta: [
        { name: 'robots', content: 'noindex, nofollow' },
        // Without this, iOS Safari paints the status-bar/toolbar areas its
        // own neutral gray instead of matching the page -- these two cover
        // the "system" theme case (most staff) for the very first paint,
        // before useTheme()'s plugin can run; it keeps both in sync with a
        // manually-picked Settings > Appearance preference afterwards (see
        // apply() in composables/useTheme.ts).
        { name: 'theme-color', content: '#F7F8FA', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#0F1014', media: '(prefers-color-scheme: dark)' },
      ],
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
  hooks: {
    // The developer portal lives at pages/developers/* but is published at
    // developers.quiroflow.com, where the URLs carry no /developers prefix.
    // Registering a prefix-free alias for each page means both hosts resolve
    // the same component -- on the server and in the browser -- without a CDN
    // rewrite that the client router would then fail to match. See
    // utils/devPortal.ts.
    //
    // The index page deliberately gets no alias: its bare path would be "/",
    // which the app's own sign-in entry point already owns. The docs
    // subdomain's root is handled by a redirect to /introduction instead.
    'pages:extend'(pages) {
      const aliases = pages
        .filter((page) => DEV_PORTAL_SLUGS.some((slug) => page.path === `/developers/${slug}`))
        .map((page) => ({ ...page, name: `${page.name}-alias`, path: page.path.replace('/developers', '') }))
      pages.push(...aliases)
    },
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
      exclude: [
        '/',
        '/login',
        '/signup',
        // Reached straight after signUp() when email confirmation is on, so by
        // definition there is no session yet -- without this it redirects to
        // /login and the person never learns a confirmation email was sent.
        '/check-email',
        '/confirm',
        '/join',
        '/portal/**',
        '/book/**',
        '/doc/**',
        '/forgot-password',
        '/reset-password',
        '/legal/**',
        // API routes authenticate themselves (bearer token for /api/public/**,
        // service-role for webhooks, a Supabase session for the rest) and
        // must never get this redirect-to-login treatment. Without this, any
        // client whose Accept header merely mentions text/html -- which
        // includes n8n's HTTP Request node in its default "Autodetect"
        // response mode, not just browsers -- gets silently redirected to
        // /login (302, HTML body) instead of reaching the route at all, with
        // no indication anything went wrong short of inspecting the raw
        // response. A logged-in browser calling its own /api/** routes never
        // hits this exclusion in practice since it already carries a session.
        '/api/**',
        // The developer portal is public documentation -- it must render for
        // someone evaluating the API who has no QuiroFlow login at all.
        // Both URL shapes are listed because both are real routes; see the
        // pages:extend hook above. '/developers' is listed separately from
        // '/developers/**' because the glob matches the pages *under* the
        // section, not the section root itself -- without it, the one URL
        // people actually type redirects to the login page.
        '/developers',
        '/developers/**',
        ...DEV_PORTAL_SLUGS.map((slug) => `/${slug}`),
      ],
    },
  },
  runtimeConfig: {
    // VeriFactu. Sending registros to the AEAT needs a qualified certificate,
    // which cannot be a file here: production is a Netlify function with no
    // filesystem to put one on, and anything bundled would be a private key
    // in the repository. So the certificate arrives base64-encoded and the
    // passphrase separately -- neither half is usable without the other.
    //
    // NOTE for whoever sets this up: a Netlify function inherits AWS Lambda's
    // limit on the TOTAL size of its environment variables, and a base64 .p12
    // is a few kilobytes of that budget. If the deploy starts refusing the
    // configuration, that is why, and the certificate needs to move to
    // storage the function reads at runtime rather than an env var.
    //
    // Defaults to the AEAT's TEST service. Production has to be asked for by
    // name; it is not what an unset variable gets you.
    verifactuEnvironment: 'test',
    verifactuCertificateBase64: '',
    verifactuCertificatePassphrase: '',
    // 'representative' (FNMT "AC Representación", tied to a person) or
    // 'seal' (an entity's certificado de sello). It picks the endpoint host,
    // and the wrong host fails at the TLS handshake.
    verifactuCertificateType: 'representative',
    resendApiKey: '',
    // Resend's webhook signing secret (Webhooks -> your endpoint in their
    // dashboard). Without it the delivery-event endpoint refuses everything,
    // which is the right way round: an unverified metrics feed is worse than
    // none, because a number nobody can trust still gets acted on.
    resendWebhookSecret: '',
    // Powers the in-app help assistant (the floating widget), which answers
    // from the help centre's own articles. Optional -- if unset, the widget
    // skips straight to "message the QuiroFlow team" rather than failing,
    // so a missing key degrades the feature instead of breaking it.
    anthropicApiKey: '',
    // Where the assistant reads the help articles from. Overridable mostly
    // so a deploy preview can point at a preview of the help centre.
    helpCorpusUrl: 'https://learn.quiroflow.com/corpus.json',
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
    // A SEPARATE Stripe account/keys from the two above -- this is
    // QuiroFlow's own billing of clinic accounts for using the product
    // itself, not Connect (which bills clinics' own patients on their
    // behalf). Deliberately never shares a client or env var with
    // stripeSecretKey so a bug in one can't reach the other's data. See
    // server/utils/platformBillingStripe.ts. Optional -- if unset, the
    // platform-billing webhook endpoint just rejects.
    stripePlatformBillingSecretKey: '',
    stripePlatformBillingWebhookSecret: '',
    stripePlatformBillingTaxRateId: '',
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
    // App Secret of the QuiroFlow PLATFORM Meta app (1377782808751290), the
    // one registered as a WhatsApp Tech Provider. Clinics onboarded through
    // Embedded Signup have their webhooks signed with THIS secret rather than
    // one of their own, because they never create a Meta app at all.
    //
    // Optional, and deliberately so: unset, every clinic falls back to the
    // per-account row in whatsapp_app_secrets exactly as before. That is what
    // lets the platform app be reviewed and rolled out without a flag day --
    // the same shape as stripeSecretKey above, where clinics that have not
    // connected still use their own pasted keys.
    metaPlatformAppSecret: '',
    // Where the Graph API lives. Overridable for exactly one reason: the
    // connect callback spends a credential and writes a token onto an
    // account, and the only way to test that hermetically is to point it at a
    // local stub. Without this, CI either leaves the whole exchange untested
    // or makes live calls to Meta from a test -- which is what it started
    // doing the moment metaPlatformAppId stopped being blank.
    metaGraphBaseUrl: 'https://graph.facebook.com/v21.0',
    public: {
      // Booking subdomains: <account-slug>.<appDomain> gets rewritten to
      // /book/<account-slug> by server/middleware/subdomain-booking.ts.
      // Defaults to localtest.me (public DNS -> 127.0.0.1) so this works
      // in local dev with no /etc/hosts changes -- set this to your real
      // domain once QuiroFlow is deployed somewhere with wildcard DNS.
      appDomain: 'localtest.me',
      // The platform Meta app's id, and the Embedded Signup configuration
      // inside it (Facebook Login for Business > Configurations). Both are
      // public by design -- they go into an FB.login() call in the browser,
      // the way stripeConnectClientId goes into a redirect URL. The secret
      // half stays server-side in metaPlatformAppSecret.
      //
      // Unset, Settings > WhatsApp simply does not offer the Connect button
      // and the manual token fields remain the only way in. That is how every
      // clinic works today, and how they keep working until this is filled.
      // Real values rather than blanks, the same way firebaseWebConfig below
      // ships its ids: neither is a secret, both are identical in every
      // environment, and hard-coding them means the Connect button works on
      // deploy with nothing to remember in Netlify. NUXT_PUBLIC_* still
      // overrides either, which is the escape hatch a fork or a second
      // platform app would need.
      //
      // What actually gates this is not these ids: it is the JavaScript SDK
      // domain allowlist on the Meta app, which contains app.quiroflow.com
      // and nothing else. The popup returns no token to any other origin, so
      // a copy of these ids elsewhere buys nobody anything.
      metaPlatformAppId: '1377782808751290',
      metaEmbeddedSignupConfigId: '1071135465616821',
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
        ignored: ['**/mobile/**', '**/.claude/worktrees/**', '**/cypress/screenshots/**', '**/cypress/videos/**', '**/cypress/downloads/**'],
      },
    },
    // These are only ever imported lazily -- papaparse and @stripe/stripe-js
    // by the CSV importer and payment components, vue-chartjs/chart.js by the
    // report pages' charts, qrcode by Settings > App and the photo-upload QR.
    // Left off this list, Vite discovers each one mid-request the first
    // time one of those components mounts on a freshly started dev server
    // and force-reloads the page to re-bundle -- which lands mid-test in CI
    // (a cold `npm run dev` every run) and wipes out whatever UI state the
    // test had just set up. Pre-bundling them here makes that discovery
    // happen at server boot instead of mid-test. vue-chartjs and qrcode were
    // measurably costing the navigation smoke shard ~50s of its 58s runtime
    // in two such mid-test reloads before they were added.
    optimizeDeps: {
      include: ['papaparse', '@stripe/stripe-js', 'vue-chartjs', 'chart.js', 'qrcode'],
    },
  },
})
