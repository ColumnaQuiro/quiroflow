import { randomUUID } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'
import { hashApiToken } from '~/server/utils/apiTokens'
// Imported as well as re-exported below: `export … from` creates no local
// binding, so the values this module uses itself have to be imported.
import { API_VERSION, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_SECONDS } from '~/utils/apiContract'
import type { ApiScope } from '~/utils/apiContract'

// Shared plumbing for the public REST API documented at
// developers.quiroflow.com. Every /api/public/v1/* route goes through
// defineApiHandler, which is what makes the guarantees the portal makes on
// our behalf actually true: bearer auth, per-scope authorisation, a rate
// limit, one error shape, and a usage log entry.
//
// The hard rule underneath all of it: an API token authenticates a *clinic
// account*, not a Postgres user. There is no session, so RLS can't scope
// anything -- these routes run as service-role and therefore every single
// query must carry .eq('account_id', accountId) by hand. accountFrom() and
// the resource registry exist so that scoping is applied in one place
// rather than remembered fifteen times.

// The contract values (version, limits, scopes) live in utils/apiContract.ts
// so the portal pages can import them without dragging the service-role
// client into the browser bundle. Re-exported here so server code has one
// obvious place to import from.
export { API_SCOPES, API_SCOPE_KEYS, API_VERSION, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_SECONDS } from '~/utils/apiContract'
export type { ApiScope } from '~/utils/apiContract'

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'conflict'
  | 'bad_gateway'
  | 'server_error'

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  conflict: 409,
  // An upstream we depend on (Meta's WhatsApp API today) refused. Separated
  // from server_error so an integrator can tell "QuiroFlow broke" from
  // "WhatsApp refused your template", which need different fixes.
  bad_gateway: 502,
  server_error: 500,
}

export class ApiError extends Error {
  code: ApiErrorCode
  status: number
  field?: string

  constructor(code: ApiErrorCode, message: string, field?: string) {
    super(message)
    this.code = code
    this.status = STATUS_FOR_CODE[code]
    this.field = field
  }
}

export function badRequest(message: string, field?: string) {
  return new ApiError('invalid_request', message, field)
}
export function notFound(resource: string) {
  return new ApiError('not_found', `No ${resource} found with that id.`)
}

// ---------------------------------------------------------------------
// Handler wrapper
// ---------------------------------------------------------------------

export interface ApiContext {
  event: H3Event
  supabase: ReturnType<typeof serverSupabaseServiceRole<Database>>
  accountId: string
  tokenId: string
  scopes: string[]
  requestId: string
}

interface HandlerOptions {
  // null means "any valid token" -- currently unused, but the metadata
  // endpoints would use it if we ever add one.
  scope: ApiScope | null
}

export function defineApiHandler<T>(options: HandlerOptions, handler: (ctx: ApiContext) => Promise<T>) {
  return defineEventHandler(async (event) => {
    const startedAt = Date.now()
    const requestId = randomUUID()
    setHeader(event, 'X-QuiroFlow-Request-Id', requestId)
    setHeader(event, 'X-QuiroFlow-Api-Version', API_VERSION)

    const supabase = serverSupabaseServiceRole<Database>(event)
    // Resolved as soon as auth succeeds so the failure log can still be
    // attributed to the right account -- a 403 on a bad scope is exactly the
    // kind of thing a clinic needs to see in their usage log.
    let accountId: string | null = null
    let tokenId: string | null = null

    async function log(statusCode: number, errorMessage?: string) {
      if (!accountId) return
      // Never let logging break the response it's describing.
      try {
        await supabase.from('api_request_logs').insert({
          account_id: accountId,
          token_id: tokenId,
          request_id: requestId,
          method: event.method,
          path: event.path.split('?')[0],
          status_code: statusCode,
          duration_ms: Date.now() - startedAt,
          error_message: errorMessage ?? null,
        } as never)
      } catch {
        // ignored on purpose
      }
    }

    try {
      const auth = await authenticate(event, supabase)
      accountId = auth.accountId
      tokenId = auth.tokenId

      if (options.scope) requireScopeOrThrow(auth.scopes, options.scope)
      await enforceRateLimit(event, supabase, auth.tokenId)

      const result = await handler({ event, supabase, accountId: auth.accountId, tokenId: auth.tokenId, scopes: auth.scopes, requestId })
      await log(getResponseStatus(event) || 200)
      return result
    } catch (err: unknown) {
      const { status, body } = toErrorResponse(err, requestId)
      setResponseStatus(event, status)
      await log(status, body.error.message)
      return body
    }
  })
}

function toErrorResponse(err: unknown, requestId: string) {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: { error: { status: err.status, code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}), request_id: requestId } },
    }
  }
  // Anything unexpected: the caller gets a request id and nothing else. The
  // real message goes to the account's usage log (which only that clinic can
  // read), not into a response that might be logged by a third party.
  const message = err instanceof Error ? err.message : 'Unexpected error'
  console.error(`[public-api] ${requestId}`, err)
  return {
    status: 500,
    body: { error: { status: 500, code: 'server_error' as const, message: 'Something went wrong on our side. Quote the request id if you contact support.', request_id: requestId } },
    internal: message,
  }
}

async function authenticate(event: H3Event, supabase: ApiContext['supabase']) {
  const header = getHeader(event, 'authorization') ?? ''
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!raw) {
    throw new ApiError('unauthorized', 'Missing bearer token. Send it as "Authorization: Bearer qf_live_…".')
  }

  const { data: token } = await supabase
    .from('api_tokens')
    .select('id, account_id, scopes, revoked_at, expires_at')
    .eq('token_hash', hashApiToken(raw))
    .maybeSingle()

  if (!token) throw new ApiError('unauthorized', 'Invalid API token.')
  if (token.revoked_at) throw new ApiError('unauthorized', 'This API token has been revoked.')
  if (token.expires_at && new Date(token.expires_at) <= new Date()) {
    throw new ApiError('unauthorized', 'This API token has expired.')
  }

  // Best-effort: a failed last_used_at write shouldn't fail the request it
  // was only meant to annotate.
  await supabase.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', token.id)

  return { accountId: token.account_id, tokenId: token.id, scopes: (token.scopes as string[]) ?? [] }
}

function requireScopeOrThrow(scopes: string[], needed: ApiScope) {
  if (!scopes.includes(needed)) {
    throw new ApiError('forbidden', `This token is missing the "${needed}" scope. Add it in QuiroFlow under Settings → Developers.`)
  }
}

async function enforceRateLimit(event: H3Event, supabase: ApiContext['supabase'], tokenId: string) {
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_token_id: tokenId,
    p_limit: RATE_LIMIT_REQUESTS,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  })
  // Fail open. If the limiter itself is broken, refusing every request would
  // turn a counter outage into a full API outage for every integration.
  if (error || !data) return

  const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; remaining: number; reset_at: string } | undefined
  if (!row) return

  const resetSeconds = Math.max(0, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000))
  setHeader(event, 'X-RateLimit-Limit', String(RATE_LIMIT_REQUESTS))
  setHeader(event, 'X-RateLimit-Remaining', String(row.remaining))
  setHeader(event, 'X-RateLimit-Reset', String(resetSeconds))

  if (!row.allowed) {
    // h3 types Retry-After as a number specifically (it's a known header).
    setHeader(event, 'Retry-After', Math.max(1, resetSeconds))
    throw new ApiError('rate_limited', `Rate limit of ${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW_SECONDS}s exceeded. Retry in ${Math.max(1, resetSeconds)}s.`)
  }
}
