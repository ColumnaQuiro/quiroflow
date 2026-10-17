import * as Sentry from '@sentry/nuxt'
import { watchSupabaseFailures } from '~/utils/supabaseFailures'

// A failed Supabase query, reported instead of rendered as "nothing here".
//
// supabase-js returns { data: null, error } rather than throwing, and most
// call sites read `data ?? []`, so a refused read, a missing column or a
// network drop shows as an empty page with no signal anywhere. This wraps
// the browser's fetch (utils/supabaseFailures.ts says which responses count)
// and, for each failure:
//
//   * reports it to Sentry when a DSN is set, else to the console -- the
//     code, table or function, method and status as tags, fingerprinted so
//     one broken query is one issue, and never a row, a filter or the query
//     string;
//   * hands it to useSupabaseFailureNotice, from which layouts/default.vue
//     shows the staff one toast per page.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public
  const { failure } = useSupabaseFailureNotice()
  watchSupabaseFailures(window, config.supabase.url, (f) => {
    failure.value = f
    // Being offline is not a bug in the code; it is told to the person
    // and not to Sentry.
    if (f.code === 'network') return
    if (config.sentryDsn) {
      Sentry.captureMessage(`Supabase ${f.code} on ${f.method} ${f.target}: ${f.message}`, {
        level: 'error',
        tags: { postgrest_code: f.code, supabase_target: f.target, http_method: f.method, http_status: String(f.status), schema_mismatch: f.schema, side: 'client' },
        extra: { path: f.path },
        fingerprint: ['supabase-failure', f.code, f.method, f.target, f.message],
      })
    } else {
      console.error(`[supabase] ${f.method} ${f.target} failed with ${f.status} ${f.code}: ${f.message}`)
    }
  })
})
