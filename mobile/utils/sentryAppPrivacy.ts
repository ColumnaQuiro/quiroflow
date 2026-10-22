// Relative, not ~/: inside the mobile build ~ is mobile/. That file imports
// only types, so nothing in it resolves from the repo root's node_modules.
import { scrubBreadcrumb, scrubEvent } from '../../utils/sentryPrivacy'

// What the app may send to Sentry, on top of what the web already holds back
// (utils/sentryPrivacy.ts: no query strings, bodies, cookies, auth headers,
// console breadcrumbs or frame variables). Pure, so tests/unit can hold it to
// its word.
//
// The app needs more than the web for two reasons:
//
//   * its patients use it, so a screen path names a record --
//     /patients/<uuid>, /reception/<patientId> -- and the web's "the path is
//     enough" would send a patient's id with every breadcrumb;
//   * what the person typed reaches error messages: a refused sign-up says
//     which email, a Supabase constraint error quotes the phone number.
//
// So every string that leaves has ids, emails, phone numbers and tokens
// replaced. Native crashes are captured by sentry-cocoa / sentry-android
// and never pass through here; what they carry is the native stack, the
// device, and the JS breadcrumbs and tags below, which are scrubbed before
// they are handed to the native side.

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// A Supabase session or any other JWT: three base64url parts, the first
// always starting eyJ ('{"').
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g
// Spanish numbers are nine digits, written with or without +34 and spaces.
// Anything with nine or more digits in a row is never useful to a bug report.
const PHONE = /\+?\d(?:[\s.-]?\d){8,}/g

// The shapes this touches, rather than @sentry/core's types: the app is on
// Sentry 10 (what @sentry/capacitor requires) and the web on 11, and this
// file is compiled by both -- the app's build and the root typecheck that
// runs tests/unit. Either version's event fits these.
interface AppBreadcrumb {
  category?: string
  message?: string
  data?: Record<string, unknown>
}
interface AppEvent {
  message?: string
  transaction?: string
  request?: { url?: string; headers?: Record<string, string> }
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: AppBreadcrumb[]
  contexts?: Record<string, unknown>
  extra?: unknown
}

export function redactText(text: string): string {
  return text.replace(JWT, '[token]').replace(UUID, ':id').replace(EMAIL, '[email]').replace(PHONE, '[number]')
}

function redactValues(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    out[key] = typeof value === 'string' ? redactText(value) : value
  }
  return out
}

export function scrubAppBreadcrumb<B extends AppBreadcrumb>(breadcrumb: B): B | null {
  const scrubbed = scrubBreadcrumb(breadcrumb as never) as B | null
  if (!scrubbed) return null
  if (scrubbed.message) scrubbed.message = redactText(scrubbed.message)
  if (scrubbed.data) scrubbed.data = redactValues(scrubbed.data)
  return scrubbed
}

export function scrubAppEvent<T extends AppEvent>(event: T): T {
  scrubEvent(event as never)
  if (event.message) event.message = redactText(event.message)
  if (event.transaction) event.transaction = redactText(event.transaction)
  if (event.request?.url) event.request.url = redactText(event.request.url)
  if (event.request?.headers) event.request.headers = redactValues(event.request.headers) as Record<string, string>
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value)
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubAppBreadcrumb).filter((b) => b !== null)
  }
  // The Vue integration attaches the failing component's props, and a
  // screen's props are its patient. attachProps is off in the plugin; this
  // is the second line.
  const vue = event.contexts?.vue as Record<string, unknown> | undefined
  if (vue) delete vue.propsData
  // Free-form, set by hand or by an integration: nothing here is needed to
  // find a bug that the stack and the tags do not already say.
  delete event.extra
  return event
}
