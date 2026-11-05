import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from './accountSecrets'

// PracticeHub's new API (PracticeHub 2.0, "v3"): https://build.practicehub.io.
//
// What differs from the Classic API the importers were written against
// (practicehub-proxy.post.ts):
//  - a `phk_` key sent as `Authorization: Bearer`, not x-practicehub-key;
//  - filters are real (`updated_at=gte:...`, `patient_id=eq:...`), where
//    Classic silently ignores unknown parameters;
//  - cursor pagination that never repeats or skips a row, where Classic
//    returns the same records on several pages;
//  - 120 requests a minute per account, bursts allowed, instead of one a
//    second.
// It reaches the clinic's real records even before the clinic switches to
// 2.0 (measured 22 Oct 2026: 1,535 patients, the Classic count).

type Service = ReturnType<typeof serverSupabaseServiceRole<Database>>

export interface PracticeHubV3Connection {
  baseUrl: string
  apiKey: string
}

/**
 * A 400 when a 2.0 `phk_` key is about to be used as the Classic one. Both
 * come from the same Developers > API Keys page, and the Classic API answers
 * a `phk_` key with a bare 403, which every import tab then shows as "the key
 * does not work" -- a clinic did exactly that on 5 Nov 2026.
 */
export function assertPracticeHubClassicKey(apiKey: string | undefined) {
  if (apiKey?.startsWith('phk_')) {
    throw createError({ statusCode: 400, statusMessage: 'That is a PracticeHub 2.0 key (phk_...), which goes in the "PracticeHub 2.0 API key" field. The API Key field takes the Classic key, from the same Developers > API Keys page, which does not start with phk_.' })
  }
}

/** The saved address and 2.0 key, or a 400 naming what is missing. */
export async function practicehubV3Connection(admin: Service, accountId: string): Promise<PracticeHubV3Connection> {
  const [{ data }, apiKey] = await Promise.all([
    admin.from('accounts').select('practicehub_base_url').eq('id', accountId).maybeSingle(),
    getAccountSecret(admin, accountId, 'practicehub_v3_api_key'),
  ])
  const baseUrl = (data?.practicehub_base_url ?? '').replace(/\/$/, '')
  if (!baseUrl || !apiKey) {
    throw createError({ statusCode: 400, statusMessage: 'No PracticeHub 2.0 connection is saved. Add the address and the phk_ key in Settings > Import > Connection.' })
  }
  return { baseUrl, apiKey }
}

/**
 * One GET against /v3/api. A 429 waits for Retry-After (or a second) and
 * tries again, up to three times; anything else that is not 2xx surfaces with
 * PracticeHub's own error code, which is stable (`unauthenticated`,
 * `not_found`, `invalid_filter`...).
 */
export async function practicehubV3Get<T = unknown>(conn: PracticeHubV3Connection, path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${conn.baseUrl}/v3/api${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${conn.apiKey}`, Accept: 'application/json' } })
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after'))
      await new Promise((r) => setTimeout(r, Number.isFinite(wait) && wait > 0 ? wait * 1000 : 1000))
      continue
    }
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      throw createError({ statusCode: res.status, statusMessage: (body as { message?: string } | null)?.message ?? 'PracticeHub API request failed', data: { code: (body as { code?: string } | null)?.code ?? null } })
    }
    return body as T
  }
}
