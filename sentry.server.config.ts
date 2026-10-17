import * as Sentry from '@sentry/nuxt'
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from './utils/sentryPrivacy'
import { watchSupabaseFailures } from './utils/supabaseFailures'

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
  // service role -- and a failed query is just as quiet here. Same report as
  // the browser's (plugins/supabase-failures.client.ts), tagged by side.
  watchSupabaseFailures(globalThis, process.env.NUXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '', (f) => {
    if (f.code === 'network') return
    Sentry.captureMessage(`Supabase ${f.code} on ${f.method} ${f.target}: ${f.message}`, {
      level: 'error',
      tags: { postgrest_code: f.code, supabase_target: f.target, http_method: f.method, http_status: String(f.status), schema_mismatch: f.schema, side: 'server' },
      extra: { path: f.path },
      fingerprint: ['supabase-failure', f.code, f.method, f.target, f.message],
    })
  })
}
