import * as Sentry from '@sentry/nuxt'
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from './utils/sentryPrivacy'
import { supabaseFailureFingerprint, watchSupabaseFailures } from './utils/supabaseFailures'
import { createConsoleThrottle, isFrameworkRequestErrorLog, serverConsoleError, serverConsoleReport } from './utils/sentryServerConsole'

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
      fingerprint: supabaseFailureFingerprint(f),
    })
  })

  // A failure the server catches and carries on from -- a cron tick that must
  // not stop for one clinic, a webhook that must still answer 200 -- is
  // console.error'd, and that reached only the function log. Sent as text
  // only, and at most once an hour per kind per instance: see
  // utils/sentryServerConsole.ts. console.warn stays in the log.
  //
  // Each request flushes before Netlify freezes the function (the SDK's h3
  // handler wrapper), so an event sent mid-request is not lost.
  const throttle = createConsoleThrottle(60 * 60 * 1000)
  const logError = console.error.bind(console)
  let reporting = false
  console.error = (...args: unknown[]) => {
    logError(...args)
    if (reporting || isFrameworkRequestErrorLog(args)) return
    reporting = true
    try {
      const report = serverConsoleReport(args)
      const { send, held } = throttle(report.fingerprint.join('|'))
      if (send) {
        Sentry.captureException(serverConsoleError(report, new Error()), {
          level: 'error',
          tags: { side: 'server', source: 'console.error' },
          ...(held ? { extra: { held_back_since_last: held } } : {}),
          fingerprint: report.fingerprint,
        })
      }
    } catch {
      // Reporting a log line must never break the code that logged it.
    } finally {
      reporting = false
    }
  }
}
