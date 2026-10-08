import * as Sentry from '@sentry/nuxt'
import { SENTRY_DATA_COLLECTION, reportSchemaMismatches, scrubBreadcrumb, scrubEvent } from './utils/sentryPrivacy'

// Error monitoring on the server: every SSR page and /api route, which on
// Netlify is the one function .netlify/functions-internal/server. The SDK
// bundles this file into the Nitro build and runs it at startup.
//
// Read from the environment rather than useRuntimeConfig, which does not
// exist yet when this runs. Same variable as the browser's.
const dsn = process.env.NUXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NUXT_PUBLIC_SENTRY_ENVIRONMENT || 'production',
    // release: injected at build time by the module (nuxt.config.ts).
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  })

  // The server reads Supabase too -- with the user's session and with the
  // service role -- and a missing column fails just as quietly here.
  reportSchemaMismatches(globalThis, process.env.NUXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '', (m) =>
    Sentry.captureMessage(`Supabase schema mismatch ${m.code}: ${m.message}`, {
      level: 'error',
      tags: { postgrest_code: m.code, side: 'server' },
      extra: { path: m.path },
      fingerprint: ['supabase-schema-mismatch', m.code, m.path, m.message],
    }),
  )
}
