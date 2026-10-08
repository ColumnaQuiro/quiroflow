import type { Breadcrumb, DataCollection, ErrorEvent } from '@sentry/core'

// What Sentry may and may not see. Shared by sentry.client.config.ts and
// sentry.server.config.ts, and pure so tests/unit can hold it to its word.
//
// This app's screens and requests are full of health data, and Sentry is a
// third party. So nothing goes that is not needed to find a bug:
//
//   * no query strings. A Supabase request carries its filters in the query
//     (`patients?first_name=ilike.*ana*`, `?phone=eq.…`), and so do search
//     pages. The path says which table or page; that is enough.
//   * no request bodies, cookies or auth headers.
//   * no console breadcrumbs -- a console.log is whatever someone printed.
//   * no local variables from stack frames -- on the server they are
//     whatever the failing function held, which is often a patient row.
//   * no IP address, and no Session Replay at all.
//
// The user is a team member id and the account id, set as tags: enough to
// find who to ask, not enough to identify a patient.

/**
 * What the SDK collects before beforeSend ever runs. Sentry 11's defaults
 * collect nearly everything -- bodies, query params, cookies, frame
 * variables -- so each one is named here and turned off. scrubEvent below is
 * the second line, for what slips through anyway.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ['user-agent', 'content-type', 'referer', 'accept-language'] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
}

/** The URL without its query string or fragment. */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

export function scrubEvent<T extends ErrorEvent>(event: T): T {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url)
    delete event.request.query_string
    delete event.request.cookies
    delete event.request.data
    if (event.request.headers) {
      const kept: Record<string, string> = {}
      for (const [name, value] of Object.entries(event.request.headers)) {
        if (/^(user-agent|referer|content-type|accept-language)$/i.test(name)) kept[name] = name.toLowerCase() === 'referer' ? scrubUrl(value) : value
      }
      event.request.headers = kept
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null)
  }
  return event
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null
  const data = breadcrumb.data
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = scrubUrl(data[key] as string)
    }
  }
  return breadcrumb
}

// -- The code and the database disagreeing --------------------------------------
//
// supabase-js does not throw: a failed query comes back as { data: null,
// error }, and most callers read `data ?? []`. So a column the code selects
// and the database does not have yet shows up as an empty list, never as an
// error -- which is how v1.9.0 shipped every patient's ledger reading
// `payments.created_by` against a table without it, and how a day went on RLS
// forensics that was really a missing column (CLAUDE.md, Migrations).
//
// These codes are only ever a bug: the request named a column, table,
// function or relationship that is not there. A refused write (RLS, a check
// constraint, "not money") is the app working and is NOT reported.
const SCHEMA_MISMATCH_CODES = new Set([
  '42703', // undefined_column
  '42P01', // undefined_table
  '42883', // undefined_function
  'PGRST200', // no relationship for an embed
  'PGRST201', // ambiguous relationship
  'PGRST202', // function not found in the schema cache
  'PGRST204', // column not found in the schema cache
  'PGRST205', // table not found in the schema cache
])

export interface SchemaMismatch {
  code: string
  message: string
  /** The REST path, e.g. /rest/v1/payments -- never the query. */
  path: string
}

/** A Supabase response that means the code and the schema disagree, or null. */
export function schemaMismatch(url: string, status: number, body: unknown): SchemaMismatch | null {
  if (status < 400) return null
  const code = (body as { code?: unknown } | null)?.code
  if (typeof code !== 'string' || !SCHEMA_MISMATCH_CODES.has(code)) return null
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = scrubUrl(url)
  }
  if (!path.includes('/rest/v1/')) return null
  const message = (body as { message?: unknown }).message
  return { code, message: typeof message === 'string' ? message : code, path }
}

/**
 * Wraps `target.fetch` so a schema mismatch from Supabase is reported, while
 * every caller still gets the response exactly as before.
 *
 * Works because supabase-js looks `fetch` up on every request
 * (`(...args) => fetch(...args)`) rather than keeping the one it saw when the
 * client was made -- so the wrapper takes effect for clients built before it.
 * The body is read from a clone, after the response has been handed back.
 */
export function reportSchemaMismatches(target: { fetch: typeof fetch }, supabaseUrl: string, report: (mismatch: SchemaMismatch) => void) {
  const original = target.fetch
  if (typeof original !== 'function' || !supabaseUrl) return
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Called on the global, not on `target`: window.fetch throws "Illegal
    // invocation" when its receiver is anything but the window.
    const response = await original.call(globalThis, input, init)
    if (response.status >= 400) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith(supabaseUrl)) {
        response
          .clone()
          .json()
          .then((body) => {
            const mismatch = schemaMismatch(url, response.status, body)
            if (mismatch) report(mismatch)
          })
          .catch(() => {})
      }
    }
    return response
  }
}
