// console.error on the server, as a Sentry event.
//
// Much of the server catches a failure on purpose and carries on: a cron tick
// must not stop for one clinic, a webhook must still answer 200 or the sender
// disables it. What it does with the failure is console.error -- ~260 call
// sites under server/ -- and that reaches only the Netlify function log,
// which nobody reads. So a cron that failed every tick looked exactly like a
// quiet one. sentry.server.config.ts sends each console.error here first.
//
// Not Sentry's captureConsoleIntegration, for two reasons:
//
//   * it sends every argument as is (`extra.arguments`). Call sites pass
//     whole objects -- a PostgrestError, whose `details` hold row values
//     ("Key (email)=(…) already exists"), a fetch error carrying the response
//     body. utils/sentryPrivacy.ts keeps console output out of Sentry for
//     exactly that reason. Here only text goes: strings, numbers and an
//     error's message, with addresses and phone numbers masked.
//   * a failure inside a loop logs once per row. Without a cap, one broken
//     rule in lead-sequence-cron would spend the month's Sentry quota in an
//     afternoon.
//
// Grouping is by the message with its ids taken out, so "run failed: <id>"
// is one issue however many runs it hits, while two different call sites
// stay two issues.

const MAX_TEXT = 1000

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// A phone number as people and APIs write one: +34 600 123 456, 34600123456.
// Nine or more digits, so a year, an HTTP status or a count is left alone,
// and spaces only, so a date (2026-11-22) is too. Meta's long numeric ids go
// as well, which costs nothing: the account id says which clinic.
const PHONE = /\+?\d(?: ?\d){8,}/g
// Any other token holding a digit, for the fingerprint only: a Stripe or
// GoCardless id (sub_1Q…, PM00…), a wamid, a month (2026-11).
const ID_LIKE = /\b[\w.-]*\d[\w.-]*\b/g

// A query string carries filters and search terms (?phone=eq.…): the path is
// enough, as utils/sentryPrivacy.ts says of URLs.
const QUERY = /([\w/.-])\?[^\s'"]+/g

/** Text that may go to Sentry: no addresses, phone numbers or query strings. */
export function maskPersonalText(text: string): string {
  // Ids are kept, and a UUID can end in twelve digits, so it is set aside
  // before looking for numbers.
  const ids = text.match(UUID) ?? []
  return text
    .split(UUID)
    .map((part) => part.replace(QUERY, '$1').replace(EMAIL, '<email>').replace(PHONE, '<number>'))
    .reduce((out, part, i) => out + (i > 0 ? ids[i - 1] : '') + part, '')
}

function printable(arg: unknown): string | null {
  if (arg === null || arg === undefined) return String(arg)
  if (typeof arg === 'string') return arg
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') return String(arg)
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (typeof arg === 'object') {
    // An error-shaped object (PostgrestError, an h3 error's data, a Stripe
    // error): its message and code, never the rest of it.
    const { message, code } = arg as { message?: unknown; code?: unknown }
    if (typeof message === 'string') return typeof code === 'string' || typeof code === 'number' ? `${message} (${code})` : message
    if (Array.isArray(arg)) return `[${arg.length} item${arg.length === 1 ? '' : 's'}]`
    return null
  }
  return null
}

/**
 * Nitro's own log of an unhandled request error ("[request error] [unhandled]
 * [GET] <url>"). The SDK's error hook has already sent that error, with its
 * real stack; a second copy would double every crash.
 */
export function isFrameworkRequestErrorLog(args: unknown[]): boolean {
  return typeof args[0] === 'string' && /^\[(nuxt\] \[)?request error\]/.test(args[0])
}

export type ServerConsoleReport = {
  /** The event's message: text only, masked. */
  message: string
  /** Groups the event: the first argument with its ids and numbers taken out. */
  fingerprint: string[]
  /** The Error among the arguments, for its stack. */
  error: Error | null
}

export function serverConsoleReport(args: unknown[]): ServerConsoleReport {
  const parts = args.map(printable).filter((p): p is string => p !== null && p !== '')
  let message = maskPersonalText(parts.join(' ')).trim() || 'console.error with nothing printable'
  if (message.length > MAX_TEXT) message = `${message.slice(0, MAX_TEXT)}…`
  const first = typeof args[0] === 'string' ? args[0] : (parts[0] ?? message)
  const template = maskPersonalText(first).replace(UUID, '<id>').replace(ID_LIKE, '<id>').slice(0, 200)
  return {
    message,
    fingerprint: ['server-console-error', template],
    error: (args.find((a) => a instanceof Error) as Error | undefined) ?? null,
  }
}

/**
 * The error Sentry is sent: the masked message, and the stack of the Error
 * that was logged if there was one (else of the console.error call). A new
 * Error rather than the logged one, whose own message is not masked.
 */
export function serverConsoleError(report: ServerConsoleReport, callSite: Error): Error {
  const e = new Error(report.message)
  e.name = 'ConsoleError'
  const frames = (report.error?.stack ?? callSite.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line))
  e.stack = [`${e.name}: ${report.message}`, ...frames].join('\n')
  return e
}

/**
 * At most one event per fingerprint per window, per function instance. What
 * it holds back is counted and sent with the next one, so a burst still says
 * how big it was.
 */
export function createConsoleThrottle(windowMs: number, maxKeys = 500) {
  const seen = new Map<string, { at: number; held: number }>()
  return (key: string, now = Date.now()): { send: boolean; held: number } => {
    const entry = seen.get(key)
    if (entry && now - entry.at < windowMs) {
      entry.held++
      return { send: false, held: 0 }
    }
    if (!entry && seen.size >= maxKeys) {
      for (const [k, v] of seen) if (now - v.at >= windowMs) seen.delete(k)
      if (seen.size >= maxKeys) return { send: false, held: 0 }
    }
    const held = entry?.held ?? 0
    seen.set(key, { at: now, held: 0 })
    return { send: true, held }
  }
}
