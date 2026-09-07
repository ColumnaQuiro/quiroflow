import type { H3Event } from 'h3'
import { ApiError, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, badRequest } from '~/server/utils/publicApi'

// Query-string handling for list endpoints: ?page / ?page_size, ?order, and
// the field=operator:value filter syntax the portal documents.
//
// One deliberate difference from PracticeHub, whose docs say invalid filters
// are ignored: here an unknown field or operator is a 400. On a read API over
// clinical records, a silently-dropped filter returns *more* rows than the
// caller asked for, and an integration that thinks it fetched one patient's
// appointments but actually fetched the whole clinic's is a privacy incident
// rather than a bug. Failing loudly is the safer default and it's documented.

export type FilterType = 'string' | 'number' | 'boolean' | 'date' | 'uuid'

const OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in', 'not-in', 'between', 'null', 'not-null'] as const
type Operator = (typeof OPERATORS)[number]

// Not filters -- consumed by pagination/ordering or by the endpoint itself.
const RESERVED = new Set(['page', 'page_size', 'order', 'from', 'to', 'clinic_id_hint'])

export interface Pagination {
  page: number
  pageSize: number
  offset: number
}

export function parsePagination(event: H3Event): Pagination {
  const q = getQuery(event)
  const page = toPositiveInt(q.page, 1, 'page')
  const requested = q.page_size === undefined ? DEFAULT_PAGE_SIZE : toPositiveInt(q.page_size, DEFAULT_PAGE_SIZE, 'page_size')
  // Clamped rather than rejected, matching PracticeHub: asking for 500 gets
  // you 100, it doesn't get you an error.
  const pageSize = Math.min(requested, MAX_PAGE_SIZE)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function toPositiveInt(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw badRequest(`"${field}" must be a positive integer.`, field)
  return n
}

export function parseOrder(event: H3Event, sortable: string[], fallback: { column: string; ascending: boolean }) {
  const raw = getQuery(event).order
  if (!raw || typeof raw !== 'string') return fallback
  // "starts_at.desc" / "starts_at.asc" / "starts_at" (asc implied)
  const [column, direction = 'asc'] = raw.split('.')
  if (!sortable.includes(column)) {
    throw badRequest(`Cannot order by "${column}". Sortable fields: ${sortable.join(', ')}.`, 'order')
  }
  if (direction !== 'asc' && direction !== 'desc') {
    throw badRequest(`Order direction must be "asc" or "desc", got "${direction}".`, 'order')
  }
  return { column, ascending: direction === 'asc' }
}

interface ParsedFilter {
  field: string
  operator: Operator
  value: string
}

export function parseFilters(event: H3Event, filterable: Record<string, FilterType>): ParsedFilter[] {
  const q = getQuery(event)
  const filters: ParsedFilter[] = []

  for (const [key, rawValue] of Object.entries(q)) {
    if (RESERVED.has(key)) continue
    if (!(key in filterable)) {
      throw badRequest(`Unknown filter "${key}". Filterable fields: ${Object.keys(filterable).join(', ')}.`, key)
    }
    // A repeated param (?id=eq:1&id=eq:2) arrives as an array; take the last
    // rather than silently applying both and producing an impossible AND.
    const value = String(Array.isArray(rawValue) ? rawValue[rawValue.length - 1] : rawValue)

    const separator = value.indexOf(':')
    const maybeOperator = separator === -1 ? '' : value.slice(0, separator)
    const isOperator = (OPERATORS as readonly string[]).includes(maybeOperator)

    // Bare "?status=booked" is a friendlier shorthand for "?status=eq:booked".
    const operator = (isOperator ? maybeOperator : 'eq') as Operator
    const operand = isOperator ? value.slice(separator + 1) : value

    validateOperand(key, operator, operand, filterable[key])
    filters.push({ field: key, operator, value: operand })
  }
  return filters
}

function validateOperand(field: string, operator: Operator, operand: string, type: FilterType) {
  if (operator === 'null' || operator === 'not-null') return

  if (operator === 'between') {
    const parts = operand.split(',')
    if (parts.length !== 2) throw badRequest(`"between" needs exactly two comma-separated bounds, e.g. ${field}=between:2026-01-01,2026-01-31.`, field)
    parts.forEach((p) => checkType(field, p, type))
    return
  }
  if (operator === 'in' || operator === 'not-in') {
    const parts = operand.split(',').filter((p) => p !== '')
    if (parts.length === 0) throw badRequest(`"${operator}" needs at least one comma-separated value.`, field)
    parts.forEach((p) => checkType(field, p, type))
    return
  }
  if (operator === 'like' && type !== 'string') {
    throw badRequest(`"like" only works on text fields, and "${field}" is a ${type}.`, field)
  }
  checkType(field, operand, type)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function checkType(field: string, value: string, type: FilterType) {
  if (type === 'number' && Number.isNaN(Number(value))) {
    throw badRequest(`"${field}" expects a number, got "${value}".`, field)
  }
  if (type === 'boolean' && value !== 'true' && value !== 'false') {
    throw badRequest(`"${field}" expects true or false, got "${value}".`, field)
  }
  if (type === 'uuid' && !UUID_RE.test(value)) {
    throw badRequest(`"${field}" expects a UUID, got "${value}".`, field)
  }
  if (type === 'date' && Number.isNaN(Date.parse(value))) {
    throw badRequest(`"${field}" expects an ISO 8601 date or datetime, got "${value}".`, field)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST's
// builder type is generic over the table and changes shape with every
// chained call; typing it precisely here would mean threading Database
// generics through every caller for no safety we don't already get from the
// filterable allowlist above.
export function applyFilters<Q extends Record<string, any>>(query: Q, filters: ParsedFilter[]): Q {
  let q = query
  for (const { field, operator, value } of filters) {
    switch (operator) {
      case 'eq':
        q = q.eq(field, value)
        break
      case 'ne':
        q = q.neq(field, value)
        break
      case 'gt':
        q = q.gt(field, value)
        break
      case 'gte':
        q = q.gte(field, value)
        break
      case 'lt':
        q = q.lt(field, value)
        break
      case 'lte':
        q = q.lte(field, value)
        break
      case 'like':
        // Documented as case-insensitive "contains" -- the operator most
        // callers actually want when they reach for LIKE, without making
        // them think about % placement.
        q = q.ilike(field, `%${value}%`)
        break
      case 'in':
        q = q.in(field, value.split(','))
        break
      case 'not-in':
        q = q.not(field, 'in', `(${value.split(',').map((v) => JSON.stringify(v)).join(',')})`)
        break
      case 'between': {
        const [low, high] = value.split(',')
        q = q.gte(field, low).lte(field, high)
        break
      }
      case 'null':
        q = q.is(field, null)
        break
      case 'not-null':
        q = q.not(field, 'is', null)
        break
    }
  }
  return q
}

// ---------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------

export interface ListEnvelope<T> {
  total_entries: number
  data: T[]
  links: { previous: string | null; self: string; next: string | null }
}

export function listEnvelope<T>(event: H3Event, rows: T[], total: number, pagination: Pagination): ListEnvelope<T> {
  const lastPage = Math.max(1, Math.ceil(total / pagination.pageSize))
  return {
    total_entries: total,
    data: rows,
    links: {
      previous: pagination.page > 1 ? pageUrl(event, pagination.page - 1) : null,
      self: pageUrl(event, pagination.page),
      next: pagination.page < lastPage ? pageUrl(event, pagination.page + 1) : null,
    },
  }
}

function pageUrl(event: H3Event, page: number) {
  // Rebuilt from the request the caller actually made, so the links carry
  // their filters forward and following next/next/next keeps the same query
  // -- the portal tells integrators to follow these instead of building
  // their own URLs, which only holds if they're complete.
  const requestUrl = getRequestURL(event)
  const url = new URL(requestUrl.toString())
  url.searchParams.set('page', String(page))
  return url.toString()
}

export function assertUuid(value: string | undefined, field: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new ApiError('invalid_request', `"${field}" must be a UUID.`, field)
  }
  return value
}
