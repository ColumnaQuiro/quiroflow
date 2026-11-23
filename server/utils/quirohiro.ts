import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'

// Reading a clinic out of QuiroHiro, the chiropractic CRM some clinics move
// to QuiroFlow from. QuiroHiro is GoHighLevel under another name (its pages
// load from leadconnectorhq.com), so it has GoHighLevel's v2 API:
// https://highlevel.stoplight.io/docs/integrations.
//
// The clinic creates a Private Integration in QuiroHiro (Configuración >
// Integraciones Privado) with read-only scopes and pastes its token here. That
// token belongs to one location (GoHighLevel's word for a clinic's
// sub-account), whose id is in every QuiroHiro address:
// app.quirohiro.io/v2/location/<id>/... Nobody signs in on the clinic's
// behalf, so QuiroHiro's two-factor login never comes into it.
//
// The API allows 100 requests every 10 seconds per location. Requests from
// one function are spaced so that is never reached, and a 429 waits and
// tries again.

type Admin = SupabaseClient<Database>

export const QUIROHIRO_API = 'https://services.leadconnectorhq.com'
const VERSION = '2021-07-28'

/** The scopes the token needs, in the words QuiroHiro's scope picker uses. */
export const QUIROHIRO_SCOPES = [
  'calendars.readonly',
  'calendars/events.readonly',
  'contacts.readonly',
  'users.readonly',
  'locations.readonly',
  'locations/customFields.readonly',
] as const

/** Only for payments and invoices: a token without them imports everything else. */
export const QUIROHIRO_MONEY_SCOPES = ['invoices.readonly', 'payments/transactions.readonly'] as const

export interface QuirohiroConnection { token: string; locationId: string }

export class QuirohiroError extends Error {
  constructor(message: string, readonly statusCode = 502) { super(message) }
}

/** The location id from a QuiroHiro address, or the id itself. */
export function quirohiroLocationId(input: string): string | null {
  const s = input.trim()
  const fromUrl = s.match(/\/location\/([A-Za-z0-9]{8,40})(?:[/?#]|$)/)
  if (fromUrl) return fromUrl[1]!
  return /^[A-Za-z0-9]{8,40}$/.test(s) ? s : null
}

export async function quirohiroSavedConnection(admin: Admin, accountId: string): Promise<QuirohiroConnection | null> {
  const [token, locationId] = await Promise.all([
    getAccountSecret(admin, accountId, 'quirohiro_token'),
    getAccountSecret(admin, accountId, 'quirohiro_location_id'),
  ])
  return token && locationId ? { token, locationId } : null
}

// One function's requests, at most one every SPACING_MS: 9 a second, under
// the 10 a second GoHighLevel allows a location.
const SPACING_MS = 110
let nextSlot = 0
async function slot() {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + SPACING_MS
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
}

const ATTEMPTS = 4
const TIMEOUT_MS = 20_000

/** Why GoHighLevel refused, in words a clinic can act on. */
function refusal(status: number, path: string, body: unknown): QuirohiroError {
  const said = (body as { message?: string | string[] } | null)?.message
  const detail = Array.isArray(said) ? said.join('; ') : said ?? ''
  if (status === 401) {
    if (/scope/i.test(detail)) {
      return new QuirohiroError(`The QuiroHiro token is missing a permission this needs (${path}). Edit the Private Integration in QuiroHiro and tick these scopes: ${QUIROHIRO_SCOPES.join(', ')}.`, 400)
    }
    return new QuirohiroError('QuiroHiro refused the token: it may have been deleted or rotated. Create a new Private Integration in QuiroHiro and save its token again.', 400)
  }
  if (status === 403) return new QuirohiroError('That token does not belong to this QuiroHiro location. Check the address you saved, and that the token was created inside that clinic\'s QuiroHiro.', 400)
  if (status === 404) return new QuirohiroError(`QuiroHiro has no ${path.split('?')[0]} for this location. Check the address you saved.`, 400)
  return new QuirohiroError(`QuiroHiro answered ${status}${detail ? `: ${detail}` : ''}`, status >= 500 ? 502 : 400)
}

/**
 * One request to the API. A rate limit, a timeout or GoHighLevel having a
 * moment is tried again after a pause; a refused token or a missing scope is
 * not, and says so (QuirohiroError with a 4xx, which ends an import job
 * rather than being retried).
 */
export async function quirohiroRequest<T>(conn: QuirohiroConnection, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(QUIROHIRO_API + path)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  for (let attempt = 1; ; attempt++) {
    await slot()
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${conn.token}`, Version: VERSION, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      if (attempt >= ATTEMPTS) throw new QuirohiroError(`QuiroHiro did not answer (${(e as Error).message})`, 504)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      continue
    }
    if (res.ok) return (await res.json()) as T
    const body = await res.json().catch(() => null)
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= ATTEMPTS) throw refusal(res.status, path, body)
    // The window is ten seconds; waiting a good part of it clears a 429.
    await new Promise((r) => setTimeout(r, res.status === 429 ? 3000 * attempt : 1000 * attempt))
  }
}

/**
 * Checks a token against a location by asking for one of each thing the
 * import reads, so a missing scope is named when the connection is saved
 * rather than ten minutes into an import. Returns the location's name.
 */
export async function quirohiroCheckConnection(conn: QuirohiroConnection): Promise<{ name: string }> {
  const location = await quirohiroRequest<{ location?: { name?: string } }>(conn, `/locations/${conn.locationId}`)
  await quirohiroRequest(conn, '/users/', { locationId: conn.locationId })
  await quirohiroRequest(conn, '/calendars/', { locationId: conn.locationId })
  await quirohiroRequest(conn, `/locations/${conn.locationId}/customFields`, { model: 'contact' })
  await quirohiroRequest(conn, '/contacts/', { locationId: conn.locationId, limit: 1 })
  return { name: location.location?.name?.trim() || conn.locationId }
}
