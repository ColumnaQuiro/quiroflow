import * as Sentry from '@sentry/nuxt'
import { SENTRY_DATA_COLLECTION, reportSchemaMismatches, scrubBreadcrumb, scrubEvent } from '~/utils/sentryPrivacy'

// Error monitoring in the browser. Off until NUXT_PUBLIC_SENTRY_DSN is set,
// so local dev, CI and any deploy without it send nothing.
//
// Errors only: no tracing and no Session Replay. A replay of this app is a
// recording of patient records, and neither is needed to find a bug. What is
// sent is scrubbed by utils/sentryPrivacy.ts.
const config = useRuntimeConfig().public

if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    // release: injected at build time by the module (nuxt.config.ts).
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    ignoreErrors: [
      // Browser chatter, not ours.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
  })

  reportSchemaMismatches(window, config.supabase.url, (m) =>
    Sentry.captureMessage(`Supabase schema mismatch ${m.code}: ${m.message}`, {
      level: 'error',
      tags: { postgrest_code: m.code, side: 'client' },
      extra: { path: m.path },
      fingerprint: ['supabase-schema-mismatch', m.code, m.path, m.message],
    }),
  )
}
