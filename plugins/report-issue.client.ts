import * as Sentry from '@sentry/nuxt'
import type { ReportIssue } from '~/utils/reportIssue'

// $reportIssue for code shared with the staff app (utils/reportIssue.ts says
// why it is provided rather than imported): to Sentry when a DSN is set, as
// sentry.client.config.ts initialises it, else to the console.
export default defineNuxtPlugin(() => {
  const dsn = useRuntimeConfig().public.sentryDsn
  const reportIssue: ReportIssue = (message, { tags, level = 'warning', fingerprint }) => {
    if (dsn) Sentry.captureMessage(message, { level, tags: { ...tags, side: 'client' }, fingerprint })
    else console.warn(`[issue] ${message}`, tags)
  }
  return { provide: { reportIssue } }
})
