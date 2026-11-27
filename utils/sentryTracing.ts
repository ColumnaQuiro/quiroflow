// How much of the server's traffic Sentry traces (sentry.server.config.ts).
// Pure, so tests/unit/sentry-tracing.test.ts can hold it to its word.
//
// Tracing is what answers "is the app getting slower?": p50/p95 per page and
// /api route, with the Supabase calls inside each request as child spans.
// Errors are not sampled -- every error is still sent.
//
// Server only. The browser stays errors-only (sentry.client.config.ts), and
// its tracing code is compiled out of the bundle (nuxt.config.ts,
// __SENTRY_TRACING__), so pages load nothing extra for this.

/** Share of server requests traced when SENTRY_TRACES_SAMPLE_RATE is not set. */
export const DEFAULT_SERVER_TRACE_RATE = 0.1

/**
 * Crons run whether or not anyone is working -- several of them every minute
 * -- so at the full rate they would be most of what is traced. A tenth of the
 * rate still gives dozens of runs a day of each.
 */
const CRON_SHARE = 0.1

/**
 * SENTRY_TRACES_SAMPLE_RATE from the function's environment: a number from 0
 * to 1. Unset or unreadable means the default; 0 turns tracing off without a
 * code change.
 */
export function serverTraceRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SERVER_TRACE_RATE
  const rate = Number(raw)
  if (!Number.isFinite(rate)) return DEFAULT_SERVER_TRACE_RATE
  return Math.min(1, Math.max(0, rate))
}

/** A request to one of the scheduled endpoints (server/api/**\/*-cron.post.ts). */
export function isCronRequest(name: string): boolean {
  return /-cron(\b|$)/.test(name)
}

interface SamplingInput {
  name: string
  attributes?: Record<string, unknown>
}

/**
 * The sampler. It decides on its own and never inherits a caller's decision:
 * the browser and the mobile app trace nothing, so a trace header from either
 * would otherwise switch the server's tracing off for that request.
 *
 * When it runs, a request's span is named only by its method ("GET"): the
 * path is in its `url.path` attribute.
 */
export function serverTracesSampler(rate: number) {
  return ({ name, attributes }: SamplingInput): number => {
    const path = typeof attributes?.['url.path'] === 'string' ? (attributes['url.path'] as string) : name
    return isCronRequest(path) ? rate * CRON_SHARE : rate
  }
}

/**
 * A path with its ids folded, so one page is one row in Sentry rather than
 * one per patient: `/patients/3f2c…-…/visits/12` → `/patients/:id/visits/:id`.
 * A segment counts as an id when it is a UUID, a number, or a token -- eight
 * or more characters mixing letters and digits (share links, payment links).
 */
export function routeOfPath(path: string): string {
  return path
    .split('/')
    .map((part) => {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) return ':id'
      if (/^\d+$/.test(part)) return ':id'
      if (part.length >= 8 && /\d/.test(part) && /[a-z]/i.test(part) && /^[\w-]+$/.test(part)) return ':id'
      return part
    })
    .join('/')
}

/**
 * Names a request's root span after its route. With span streaming the SDK
 * starts it as just the method, and nothing in this Nitro setup renames it,
 * so every page and API call would land in Sentry as one "GET" or "POST".
 */
export function nameRequestSpan<T extends { name: string; is_segment: boolean; attributes: unknown }>(span: T): T {
  if (!span.is_segment || !/^[A-Z]+$/.test(span.name)) return span
  const raw = (span.attributes as Record<string, unknown>)['url.path']
  const path = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof (raw as { value?: unknown }).value === 'string' ? (raw as { value: string }).value : null
  if (path) span.name = `${span.name} ${routeOfPath(path)}`
  return span
}
