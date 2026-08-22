import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

// Token generation happens client-side in Settings > Developers (Web Crypto
// is available in the browser and the raw value never needs to leave it
// except in the insert -- see that page). This just re-derives the same
// hash server-side to verify an incoming bearer token.
export function hashApiToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

// Auth for the public API: no Supabase session exists (an external caller
// like n8n hits this directly), so it authenticates via a bearer token
// looked up by hash, service-role, then manually scopes every subsequent
// query to that token's account_id -- same pattern as the Meta webhook,
// which also has no session and resolves its own tenant.
export async function requireApiToken(event: H3Event) {
  const supabase = serverSupabaseServiceRole<Database>(event)
  const auth = getHeader(event, 'authorization') ?? ''
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!raw) {
    throw createError({ statusCode: 401, statusMessage: 'Missing bearer token. Pass it as "Authorization: Bearer <token>".' })
  }

  const hash = hashApiToken(raw)
  const { data: token } = await supabase
    .from('api_tokens')
    .select('id, account_id, scopes, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (!token || token.revoked_at) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or revoked API token.' })
  }

  await supabase.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', token.id)

  return { supabase, accountId: token.account_id, scopes: token.scopes as string[] }
}

export function requireScope(scopes: string[], needed: string) {
  if (!scopes.includes(needed)) {
    throw createError({ statusCode: 403, statusMessage: `This token doesn't have the "${needed}" scope.` })
  }
}
