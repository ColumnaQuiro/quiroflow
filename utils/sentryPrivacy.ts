import type { Breadcrumb, DataCollection, ErrorEvent } from '@sentry/core'

// What Sentry may and may not see. Shared by sentry.client.config.ts and
// sentry.server.config.ts, and pure so tests/unit can hold it to its word.
// Which Supabase failures are worth an alert is utils/supabaseFailures.ts.
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
