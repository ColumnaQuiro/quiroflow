import * as Sentry from '@sentry/nuxt'
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from '~/utils/sentryPrivacy'
import { isUnloadNoise, trackUnload } from '~/utils/sentryUnloadNoise'
import { isChunkLoadError, newerBuildIsLive } from '~/utils/sentryStaleChunk'

// Error monitoring in the browser. Off until NUXT_PUBLIC_SENTRY_DSN is set,
// so local dev, CI and any deploy without it send nothing.
//
// Errors only: no tracing and no Session Replay. A replay of this app is a
// recording of patient records, and neither is needed to find a bug. What is
// sent is scrubbed by utils/sentryPrivacy.ts.
const config = useRuntimeConfig().public
const app = useRuntimeConfig().app

// The query string makes every check miss the CDN cache (see the reload plugin).
function latestBuild() {
  return $fetch<{ id: string }>(`${app.buildAssetsDir}builds/latest.json`, { query: { t: Date.now() } })
}

if (config.sentryDsn) {
  trackUnload(window)
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    // release: injected at build time by the module (nuxt.config.ts).
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: 0,
    // A replaceState refused while the page closes is dropped: see
    // utils/sentryUnloadNoise.ts.
    // So is a chunk that 404s because a newer build went live while the tab
    // was open -- plugins/stale-build-reload.client.ts reloads for that. See
    // utils/sentryStaleChunk.ts.
    beforeSend: async (event, hint) => {
      if (isUnloadNoise(hint.originalException)) return null
      if (isChunkLoadError(hint.originalException) && (await newerBuildIsLive(app.buildId, latestBuild))) return null
      return scrubEvent(event)
    },
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    ignoreErrors: [
      // Browser chatter, not ours.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
  })

  // Failed Supabase queries are reported by plugins/supabase-failures.client.ts.
}
