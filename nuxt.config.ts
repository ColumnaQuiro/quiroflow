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
      // iOS zooms the whole page into any field whose text is under 16px --
      // nearly every input here is 13px -- and does not zoom back out when
      // the field loses focus, so staff on an iPhone were left pinching the
      // page back after every form. maximum-scale=1 stops that zoom-on-focus;
      // iOS still lets people pinch-zoom themselves (it has ignored the
      // setting for user gestures since iOS 10). Only on iOS: Android honours
      // maximum-scale for pinching too, which would take zoom away from
      // anyone who needs it, and Android does not zoom on focus anyway.
      // Inline and in <head> so it is in place before the first tap, on the
      // server-rendered pages (booking, docs) as much as inside the app.
      script: [
        {
          key: 'ios-no-focus-zoom',
          tagPosition: 'head',
          innerHTML:
            "(function(){var n=navigator,ios=/iP(hone|ad|od)/.test(n.userAgent)||(n.platform==='MacIntel'&&n.maxTouchPoints>1);if(!ios)return;var m=document.querySelector('meta[name=viewport]');if(m&&m.content.indexOf('maximum-scale')<0)m.content+=', maximum-scale=1'})()",
        },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'alternate icon', href: '/favicon.ico' },
        // The body face, fetched alongside the stylesheet instead of after it
        // (the browser only discovers an @font-face file once the CSS has
        // parsed and some text needs it). Declared in assets/css/theme.css;
        // the mono face and the latin-ext subsets are left to load on demand.
        // `crossorigin` is required even same-origin -- font requests are
        // CORS-mode, and a preload without it is fetched twice.
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/instrument-sans-latin.woff2', crossorigin: 'anonymous' },
      ],
    },
  },
  nitro: {
    preset: 'netlify',
    // The CI e2e build runs `.output/server/index.mjs` from the checkout,
    // whose node_modules the shard has restored, so Nitro need not trace and
    // copy 37 MB of dependencies into .output -- the longest part of that
    // build (62s -> 44s locally) and most of the artifact every shard
    // downloads (52 MB -> 15 MB). Node resolves the externals upward from
    // .output/server/ as it would from any file in the repo. Production
    // (the netlify preset) keeps tracing: the function ships alone.
    ...(process.env.E2E_BUILD ? { externals: { trace: false } } : {}),
    hooks: {
      // Nitro writes every server/api route into a typed table
      // (.nuxt/types/nitro-routes.d.ts) so that `$fetch('/api/x')` can infer
      // the handler's return type. The inference does that by scoring the URL
      // against every route pattern with template-literal types, and the
      // first `$fetch` call TypeScript checks in a run pays for that matcher
      // with the URL erased to its constraint -- the union of ALL routes --
      // so it scores every route against every route: O(routes²). At 200
      // routes that one expression cost 5.1 million type instantiations,
      // measured, and TypeScript aborts an expression at 5 million with
      // TS2589 "Type instantiation is excessively deep", reported on whichever
      // call site happened to be checked first (components/booking/Payment.vue
      // on 18 and 19 Oct 2026; #791 and the receptionist revamp). So the
      // 201st route of any shape failed `nuxi typecheck` in a file that had
      // nothing to do with it, and so would every route after it.
      //
      // An empty table makes the matcher trivial, and the app loses nothing it
      // used: every `$fetch` to our API already states its response type
      // (`$fetch<T>(...)`), as does the one useFetch, and the mobile app and
      // the server never relied on the inference. `$fetch('/api/x')` without
      // a type now returns `unknown`, as it does in any Nuxt project with no
      // routes; say what the route returns in the generic.
      'types:extend'(types) {
        types.routes = {}
      },
    },
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
    // The public booking page is rendered on the server with the clinic's
    // practitioners, services and details already in the HTML
    // (pages/book/[slug].vue), and that HTML is the same for every visitor
    // of the URL for as long as the clinic's settings hold. `isr` is what
    // the Netlify preset turns into Netlify-CDN-Cache-Control (max-age 60,
    // stale-while-revalidate, durable): a repeat visit inside the minute is
    // answered by the CDN without the function running, and the first one
    // after it gets the stale copy while a fresh render replaces it.
    //
    // Not `swr`. On this Nitro version that is Nitro's OWN in-process cache
    // -- per Lambda instance, nothing durable about it -- and it would also
    // run under `nuxt dev` and the node-server build Cypress runs against,
    // where a spec that changes a clinic's settings and reloads expects to
    // see them. `isr` is a no-op everywhere but the Netlify runtime
    // (nitropack/dist/presets/netlify/runtime/netlify.mjs).
    //
    // The page sends no-store itself when a copy must not be kept (a staff
    // preview carrying a session, a failed fetch). The query string is part
    // of Netlify's cache key, so ?type= and the attribution params each get
    // their own copy and the embed keeps working unchanged.
    '/book/**': { isr: 60 },
    // The font files carry no content hash in their names, so without this
    // Netlify serves them with max-age=0 and every visit revalidates each
    // one. Written to dist/_headers by the Netlify preset (and applied by
    // Nitro elsewhere). A changed font therefore needs a new filename.
    '/fonts/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },
  // The CI e2e build (E2E_BUILD) leaves the Sentry module out: it has no DSN
  // there, nothing in the suite looks for it, and its Vite plugin runs over
  // every module of both builds. The runtime imports of @sentry/nuxt in the
  // plugins still resolve; without init they are no-ops.
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase', '@pinia/nuxt', ...(process.env.E2E_BUILD ? [] : ['@sentry/nuxt/module'])],
  // Error monitoring (sentry.client.config.ts, sentry.server.config.ts). It
  // sends nothing until NUXT_PUBLIC_SENTRY_DSN is set. These options are the
  // BUILD side only: the release is the commit the deploy builds, and source
  // maps are uploaded -- then deleted, so they are never served -- only when
  // SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are in the build's
  // environment. Without them the build is exactly as before.
  sentry: {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    telemetry: false,
    release: { name: process.env.GITHUB_SHA || undefined },
    sourcemaps: {
      disable: !process.env.SENTRY_AUTH_TOKEN,
      filesToDeleteAfterUpload: ['dist/**/*.map', '.output/**/public/**/*.map'],
    },
  },
  // The CI e2e build (E2E_BUILD) has no server maps: they were 19s of its 75s
  // locally, on the path every Cypress shard waits on, and the node-server
  // bundle they map is unminified anyway. Everywhere else `server` stays
  // UNSET rather than true -- @sentry/nuxt turns an unset one into 'hidden'
  // and deletes the maps after upload, and an explicit true opts out of both.
  sourcemap: {
    client: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
    ...(process.env.E2E_BUILD ? { server: false } : {}),
  },
  // The stylesheet as a file, not inlined into every page's HTML. Inlined, it
  // was 92 KB of the sign-in page's 112 and arrived again with every full
  // load or refresh, never cached. The people using this app reload it all
  // day, so a stylesheet the browser keeps is the better trade than saving a
  // first-ever visitor one request.
  features: { inlineStyles: false },
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
        // The unsubscribe link in a marketing email: opened by a patient
        // with no QuiroFlow login, gated by its own signed token.
        '/unsubscribe/**',
        // A satisfaction survey ("¿qué tal te hemos atendido?"): a patient's
        // link from a message, with no login, gated by its own token.
        '/valorar/**',
        // An article a clinic sent a patient without the app: no login, gated
        // by its own token (pages/aprende).
        '/aprende/**',
        // A clinic's gift voucher page: bought by someone with no QuiroFlow
        // login, like the booking page.
        '/regalo/**',
        // Where Stripe Checkout returns after a patient pays from the app: the
        // phone's browser, with no QuiroFlow session.
        '/payment-done',
        // The waitlist claim link and the photo-upload QR: opened on a
        // patient's phone with no QuiroFlow login, gated by their own token.
        // Not a '*' glob: the module turns each pattern into a regex by
        // swapping '*' for '.*', so '/waitlist/*' also matched '/waitlist/'
        // with an empty token -- and the router serves the STAFF waitlist page
        // (pages/waitlist/index.vue) there, which rendered logged-out. Written
        // as the regex itself, a token of one segment is required, and
        // /waitlist and /waitlist/ stay behind the login.
        '/waitlist/[^/]+',
        '/photo-upload/[^/]+',
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
    // VeriFactu. Whether a clinic transmits, to which AEAT service, and with
    // which certificate are all that clinic's own settings (Settings >
    // VeriFactu) -- they used to be environment variables here, which only
    // ever fitted one clinic.
    //
    // What stays is one PLATFORM key, 32 random bytes base64
    // (`openssl rand -base64 32`), that encrypts each clinic's certificate
    // passphrase before it is stored. A copy of the database is then not a
    // usable certificate without the deploy, and the deploy is not one
    // without the database. Changing it makes every stored passphrase
    // unreadable, so each clinic would have to enter theirs again.
    verifactuSecretKey: '',
    resendApiKey: '',
    // Fallback provider for when Resend's free daily quota runs out (see
    // server/utils/resend.ts). Optional: unset means Resend only, as before.
    // Must be QuiroFlow's own Brevo account (hola@quiroflow.com) with
    // quiroflow.com authenticated, or every fallback send is refused.
    brevoApiKey: '',
    brevoSenderEmail: '',
    // Where "someone just signed up" goes. Empty means no notification is
    // sent and onboarding is unaffected -- same contract as the Netlify
    // token above: a missing integration must never break an account being
    // created. Set NUXT_SIGNUP_NOTIFY_EMAIL to switch it on.
    signupNotifyEmail: '',
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
    // Apple Wallet pass signing (server/utils/walletPass.ts): the pass type
    // certificate and its private key for pass.com.quiroflow.bono, each as
    // base64 of the PEM (NUXT_WALLET_PASS_CERT, NUXT_WALLET_PASS_KEY). Empty
    // means Wallet is off: the button does not show and the endpoints say so.
    walletPassCert: '',
    walletPassKey: '',
    // Google Wallet (server/utils/googleWallet.ts): the issuer id from the Pay
    // & Wallet Console (NUXT_GOOGLE_WALLET_ISSUER_ID) and the JSON key of the
    // service account that issues for it, base64 (NUXT_GOOGLE_WALLET_KEY).
    // Either empty means Google Wallet is off, as above.
    googleWalletIssuerId: '',
    googleWalletKey: '',
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
      // Sentry: the DSN only allows sending events, so it is public by
      // design. Blank turns monitoring off (NUXT_PUBLIC_SENTRY_DSN), and the
      // environment tells production from a draft deploy
      // (NUXT_PUBLIC_SENTRY_ENVIRONMENT). Flat keys, not `public.sentry`:
      // the Sentry module claims that one and replaces it with its own empty
      // object, which silently left the browser with no DSN at all.
      sentryDsn: '',
      sentryEnvironment: 'production',
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
      // A second Facebook Login for Business configuration on the same app,
      // for Settings > Leads: it asks for the clinic's Pages and the lead
      // permissions (leads_retrieval, pages_manage_metadata, ...) instead of
      // a WhatsApp Business Account. "QuiroFlow lead ads", created 8 Oct
      // 2026: system-user token that never expires (no refresh exists, so a
      // 60-day token would stop leads silently), Pages required, ad accounts
      // optional at ANALYZE only, and leads_retrieval, pages_show_list,
      // pages_read_engagement, pages_manage_metadata, pages_manage_ads and
      // ads_management. Blank hides the Connect card.
      metaLeadAdsConfigId: '2889323534772175',
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
    // The CI e2e build skips gzipping every client chunk to print its size:
    // a few seconds nobody reads on the path every shard waits on.
    build: process.env.E2E_BUILD ? { reportCompressedSize: false } : {},
    // Sentry runs errors-only here (tracesSampleRate 0, no replay -- see
    // sentry.client.config.ts), so its tracing and debug-logging code is dead
    // weight in the bundle every page loads. These are the flags Sentry's own
    // bundleSizeOptimizations sets, set here so they apply to every build:
    // the module only adds its plugin when source maps are being uploaded.
    define: {
      __SENTRY_DEBUG__: false,
      __SENTRY_TRACING__: false,
    },
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
