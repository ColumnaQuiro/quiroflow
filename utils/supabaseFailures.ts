import { scrubUrl } from './sentryPrivacy'

// A failed Supabase query, made visible.
//
// supabase-js does not throw: a failed query comes back as { data: null,
// error }, and about 160 call sites read `data ?? []`. So a refused read, a
// column the database does not have yet, a PostgREST that is down or a
// network that dropped all render as "nothing here", with no signal
// anywhere -- which is how a day went on RLS forensics that was really a
// missing column (CLAUDE.md, Migrations). This module watches the responses
// instead of the call sites: every PostgREST request goes through one
// `fetch`, and the status and the body say what went wrong.
//
// Pure, so tests/unit can hold it to its word. Which failures are reported
// is decided in classifySupabaseFailure, and what is reported never carries
// a row, a filter value or a query string.
//
// No `~/` imports: this file is also compiled into mobile/ (see
// mobile/nuxt.config.ts), where `~` means mobile/.

export interface SupabaseFailure {
  /** The HTTP status, or 0 when the request never got a response. */
  status: number
  /** GET, HEAD, POST, PATCH or DELETE. */
  method: string
  /**
   * The Postgres or PostgREST error code ('42703', 'PGRST202'), 'http_<status>'
   * when the response carried no code (a HEAD, a gateway page), or 'network'
   * when fetch itself rejected.
   */
  code: string
  /** The error message, with any value it quoted taken out. */
  message: string
  /** The REST path, e.g. /rest/v1/payments -- never the query string. */
  path: string
  /** The table ('payments') or function ('rpc/get_my_bootstrap') the request named. */
  target: string
  /** The code names a column, table, function or relationship that is not there. */
  schema: boolean
  /** A read -- GET, HEAD or an RPC -- which a page would otherwise show as "nothing here". */
  read: boolean
}

// These codes are only ever a bug: the request named a column, table,
// function or relationship that is not there.
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

// The database saying no, in words the call site shows: a rule the app
// enforces, not a query that broke.
const REFUSAL_CODES = new Set([
  'P0001', // raise_exception: "Only an owner can…", "Two-factor authentication required", "not money"
  '23514', // check_violation
])

// Statuses the code handles itself, or that are not about the query.
const EXPECTED_STATUSES = new Set([
  401, // the session expired; supabase-js refreshes it and @nuxtjs/supabase sends them to /login
  406, // .single()/.maybeSingle() found zero rows, or more than one (PGRST116)
  409, // a conflict -- 23505 duplicate, 23503 still referenced -- shown at the call site
  416, // a page asked for past the end of the rows (PGRST103)
])

/** The error message with the values it may quote taken out, and nothing else. */
export function scrubPostgrestMessage(message: string): string {
  return message
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    // Key (phone)=(600000000) already exists.
    .replace(/\(([^()]*)\)=\([^()]*\)/g, '($1)=(…)')
    // A phone, a document number, a postcode.
    .replace(/\d{5,}/g, '…')
    .slice(0, 300)
}

function restPath(url: string): string | null {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = scrubUrl(url)
  }
  return path.includes('/rest/v1/') ? path : null
}

function targetOf(path: string): string {
  return path.slice(path.indexOf('/rest/v1/') + '/rest/v1/'.length) || 'rest'
}

function isRead(method: string, target: string): boolean {
  return method === 'GET' || method === 'HEAD' || target.startsWith('rpc/')
}

export interface SupabaseResponseInput {
  url: string
  method: string
  status: number
  /** The parsed JSON body, or null when there was none (a HEAD, a gateway page). */
  body: unknown
}

/**
 * The failure a PostgREST response amounts to, or null when it is not one:
 * a success, something other than the REST API, or one of the refusals
 * the call sites handle themselves.
 */
export function classifySupabaseFailure({ url, method, status, body }: SupabaseResponseInput): SupabaseFailure | null {
  if (status < 400) return null
  const path = restPath(url)
  if (!path) return null
  const target = targetOf(path)
  method = method.toUpperCase()
  const read = isRead(method, target)

  if (EXPECTED_STATUSES.has(status)) return null
  const rawCode = (body as { code?: unknown } | null)?.code
  const code = typeof rawCode === 'string' && rawCode ? rawCode : `http_${status}`
  if (code === 'PGRST116' || code === 'PGRST103') return null
  if (REFUSAL_CODES.has(code)) return null
  // A refused write (42501: RLS, or a definer RPC refusing a password-only
  // session before its second factor is in) is the app working, and the save
  // path shows why. A refused READ is reported: RLS never 403s a select, it
  // filters, so a forbidden GET is a table the role cannot read at all -- a
  // missing grant.
  if ((status === 403 || code === '42501') && method !== 'GET' && method !== 'HEAD') return null

  const schema = SCHEMA_MISMATCH_CODES.has(code)
  const rawMessage = (body as { message?: unknown } | null)?.message
  const message = typeof rawMessage === 'string' && rawMessage ? (schema ? rawMessage : scrubPostgrestMessage(rawMessage)) : code
  return { status, method, code, message, path, target, schema, read }
}

/** The failure a rejected fetch amounts to, or null when it was deliberately aborted. */
export function classifySupabaseNetworkFailure(url: string, method: string, error: unknown): SupabaseFailure | null {
  if ((error as { name?: unknown } | null)?.name === 'AbortError') return null
  const path = restPath(url)
  if (!path) return null
  const target = targetOf(path)
  method = method.toUpperCase()
  return { status: 0, method, code: 'network', message: 'The request never got a response', path, target, schema: false, read: isRead(method, target) }
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
}

/**
 * Wraps `target.fetch` so every failed PostgREST request is handed to
 * `onFailure`, while every caller still gets the response exactly as
 * before.
 *
 * Works because @nuxtjs/supabase's fetch (fetchWithRetry) and supabase-js's
 * own default both look `fetch` up on every request rather than keeping the
 * one they saw when the client was made -- so the wrapper takes effect for
 * clients built before it. The body is read from a clone, after the response
 * has been handed back.
 */
export function watchSupabaseFailures(target: { fetch: typeof fetch }, supabaseUrl: string, onFailure: (failure: SupabaseFailure) => void) {
  const original = target.fetch
  if (typeof original !== 'function' || !supabaseUrl) return
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const ours = url.startsWith(supabaseUrl)
    let response: Response
    try {
      // Called on the global, not on `target`: window.fetch throws "Illegal
      // invocation" when its receiver is anything but the window.
      response = await original.call(globalThis, input, init)
    } catch (error) {
      if (ours) {
        try {
          const failure = classifySupabaseNetworkFailure(url, requestMethod(input, init), error)
          if (failure) onFailure(failure)
        } catch {
          // The failure is thrown to the caller below; reporting it is best effort.
        }
      }
      throw error
    }
    if (ours && response.status >= 400) {
      const method = requestMethod(input, init)
      response
        .clone()
        .json()
        .catch(() => null)
        .then((body) => {
          const failure = classifySupabaseFailure({ url, method, status: response.status, body })
          if (failure) onFailure(failure)
        })
        .catch(() => {})
    }
    return response
  }
}

/**
 * The data of a Supabase result, or its error thrown.
 *
 * For a loader that would otherwise read `data ?? []` and show a failed
 * query as an empty list: the throw keeps what was on screen, and lands in
 * Sentry with the loader's own stack. Leaves the data's type alone, so a
 * `.maybeSingle()` still reads as "row or null" and a `?? []` still applies.
 */
export function dataOrThrow<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw result.error
  return result.data
}
