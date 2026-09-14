import type { H3Event } from 'h3'
import { badRequest } from '~/server/utils/publicApi'

// Body validation for the write endpoints. Small and explicit on purpose --
// a schema library would be a new dependency for eight endpoints, and the
// error messages hand-written here ("starts_at must be an ISO 8601
// datetime, got …") are the ones an integrator actually reads at 2am.

export type Body = Record<string, unknown>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function readApiBody(event: H3Event): Promise<Body> {
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object. Did you set Content-Type: application/json?')
  }
  return body as Body
}

// Rejects unrecognised keys rather than ignoring them. A typo'd field name
// that's silently dropped looks like a successful write that didn't happen,
// and integrators lose hours to it.
export function rejectUnknownFields(body: Body, allowed: string[]) {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k))
  if (unknown.length) {
    throw badRequest(`Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Accepted: ${allowed.join(', ')}.`, unknown[0])
  }
}

export function str(body: Body, field: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const value = body[field]
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw badRequest(`"${field}" is required.`, field)
    return undefined
  }
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string.`, field)
  const trimmed = value.trim()
  if (opts.max && trimmed.length > opts.max) throw badRequest(`"${field}" must be ${opts.max} characters or fewer.`, field)
  return trimmed
}

export function uuid(body: Body, field: string, opts: { required?: boolean } = {}): string | undefined {
  const value = str(body, field, opts)
  if (value === undefined) return undefined
  if (!UUID_RE.test(value)) throw badRequest(`"${field}" must be a UUID.`, field)
  return value
}

export function email(body: Body, field: string): string | undefined {
  const value = str(body, field, { max: 320 })
  if (value === undefined) return undefined
  if (!EMAIL_RE.test(value)) throw badRequest(`"${field}" is not a valid email address.`, field)
  return value
}

// Calendar date (YYYY-MM-DD), not an instant -- date_of_birth is a date and
// accepting a datetime for it invites timezone-shifted birthdays.
export function dateOnly(body: Body, field: string): string | undefined {
  const value = str(body, field)
  if (value === undefined) return undefined
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw badRequest(`"${field}" must be a date in YYYY-MM-DD form, got "${value}".`, field)
  }
  return value
}

export function isoDateTime(body: Body, field: string, opts: { required?: boolean } = {}): string | undefined {
  const value = str(body, field, opts)
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw badRequest(`"${field}" must be an ISO 8601 datetime, e.g. 2026-03-14T09:30:00Z. Got "${value}".`, field)
  // Normalised to UTC so two callers sending the same instant in different
  // offsets store an identical value, and overlap checks compare like for like.
  return new Date(parsed).toISOString()
}

export function integer(body: Body, field: string, opts: { min?: number; max?: number } = {}): number | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  // Rejecting "1200" rather than coercing it. A money field that silently
  // accepts strings is how a caller ships `"12.50"` for months and nobody
  // notices until the total is wrong.
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw badRequest(`"${field}" must be a whole number.`, field)
  }
  if (opts.min !== undefined && value < opts.min) throw badRequest(`"${field}" must be ${opts.min} or more.`, field)
  if (opts.max !== undefined && value > opts.max) throw badRequest(`"${field}" must be ${opts.max} or less.`, field)
  return value
}

export function bool(body: Body, field: string): boolean | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw badRequest(`"${field}" must be true or false.`, field)
  return value
}

export function enumValue<T extends string>(body: Body, field: string, allowed: readonly T[], opts: { required?: boolean } = {}): T | undefined {
  const value = str(body, field, opts)
  if (value === undefined) return undefined
  if (!(allowed as readonly string[]).includes(value)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}. Got "${value}".`, field)
  }
  return value as T
}

export function stringArray(body: Body, field: string): string[] | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw badRequest(`"${field}" must be an array of strings.`, field)
  }
  return value as string[]
}

// Drops keys the caller didn't send, so a PATCH only touches what it named
// and an absent field never overwrites a stored value with null.
export function definedOnly<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>
}
