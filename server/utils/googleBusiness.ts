import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'
import { importedReview, type GoogleReview } from '~/utils/googleReviews'

// A clinic's Google Business Profile: connecting it, importing its reviews
// into `reviews`, and posting a reply the clinic approved.
//
// Three APIs on three hosts, because that is how Google split the old My
// Business API: accounts on mybusinessaccountmanagement, locations on
// mybusinessbusinessinformation, and reviews -- never migrated -- still on
// the v4 mybusiness host. All of them refuse with a quota of 0 until Google
// approves the project's Basic API Access request, which presents as a 429
// rather than as "not approved"; googleError() says so.

const SCOPE = 'https://www.googleapis.com/auth/business.manage'
const STATE_TTL_MS = 15 * 60 * 1000

/** A Google URL, or the local stub's when NUXT_GOOGLE_API_BASE_URL is set (see nuxt.config.ts). */
export function googleUrl(host: string, path: string): string {
  const base = useRuntimeConfig().googleApiBaseUrl
  return base ? `${base.replace(/\/$/, '')}/${host}${path}` : `https://${host}${path}`
}

export function googleBusinessConfigured(): boolean {
  const config = useRuntimeConfig()
  return Boolean(config.googleBusinessClientId && config.googleBusinessClientSecret)
}

export function googleRedirectUri(origin: string): string {
  return `${origin}/api/google-business/callback`
}

// The OAuth state. Google sends the browser back to the callback with no
// staff session header, so the state itself has to say who started the
// connection -- and has to be impossible to forge, or anybody could attach
// their own Google listing to another clinic. Signed with the client secret,
// which only this server holds, and short-lived.
function sign(payload: string): string {
  return createHmac('sha256', useRuntimeConfig().googleBusinessClientSecret).update(payload).digest('base64url')
}

export function signedState(accountId: string, teamMemberId: string): string {
  const payload = Buffer.from(JSON.stringify({ a: accountId, m: teamMemberId, t: Date.now(), n: randomBytes(8).toString('hex') })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readState(state: string): { accountId: string; teamMemberId: string } | null {
  const [payload, signature] = state.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const { a, m, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof a !== 'string' || typeof m !== 'string' || typeof t !== 'number' || Date.now() - t > STATE_TTL_MS) return null
    return { accountId: a, teamMemberId: m }
  } catch {
    return null
  }
}

export function consentUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: useRuntimeConfig().googleBusinessClientId,
    redirect_uri: googleRedirectUri(origin),
    response_type: 'code',
    scope: SCOPE,
    // Offline, and consent every time: Google only hands out a refresh token
    // on a consent screen, and a reconnect without one would leave the clinic
    // with an access token that dies in an hour.
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  const base = useRuntimeConfig().googleApiBaseUrl
  return `${base ? `${base.replace(/\/$/, '')}/accounts.google.com` : 'https://accounts.google.com'}/o/oauth2/v2/auth?${params}`
}

/** Google's reason, in words a clinic owner can act on. */
export function googleError(err: any): string {
  const status = err?.status ?? err?.response?.status
  const message = err?.data?.error?.message ?? err?.data?.error_description ?? err?.message ?? 'Unknown error'
  if (status === 429) return `Google refused for quota (${message}). Until Google approves Business Profile API access for this project, every call is refused this way.`
  if (status === 401 || err?.data?.error === 'invalid_grant') return 'Google no longer accepts this connection. Connect your Google profile again.'
  return message
}

export async function exchangeCode(origin: string, code: string): Promise<{ refreshToken: string | null; accessToken: string }> {
  const config = useRuntimeConfig()
  const response = await $fetch<{ access_token: string; refresh_token?: string }>(googleUrl('oauth2.googleapis.com', '/token'), {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: config.googleBusinessClientId,
      client_secret: config.googleBusinessClientSecret,
      redirect_uri: googleRedirectUri(origin),
      grant_type: 'authorization_code',
    }),
  })
  return { refreshToken: response.refresh_token ?? null, accessToken: response.access_token }
}

/** A fresh access token for this account, or null when it has never connected. */
export async function googleAccessToken(service: SupabaseClient<Database>, accountId: string): Promise<string | null> {
  const refreshToken = await getAccountSecret(service, accountId, 'google_business_refresh_token')
  if (!refreshToken) return null
  const config = useRuntimeConfig()
  const response = await $fetch<{ access_token: string }>(googleUrl('oauth2.googleapis.com', '/token'), {
    method: 'POST',
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.googleBusinessClientId,
      client_secret: config.googleBusinessClientSecret,
      grant_type: 'refresh_token',
    }),
  })
  return response.access_token
}

export interface GoogleLocation {
  account: string
  location: string
  title: string
  address: string | null
}

/** Every listing this Google user manages, across every Business Profile account they belong to. */
export async function listLocations(accessToken: string): Promise<GoogleLocation[]> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  const { accounts = [] } = await $fetch<{ accounts?: { name: string }[] }>(googleUrl('mybusinessaccountmanagement.googleapis.com', '/v1/accounts'), { headers })
  const found: GoogleLocation[] = []
  for (const account of accounts) {
    let pageToken: string | undefined
    do {
      const page = await $fetch<{ locations?: { name: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[]; nextPageToken?: string }>(
        googleUrl('mybusinessbusinessinformation.googleapis.com', `/v1/${account.name}/locations`),
        { headers, query: { readMask: 'name,title,storefrontAddress', pageSize: 100, ...(pageToken ? { pageToken } : {}) } },
      )
      for (const l of page.locations ?? []) {
        const address = [...(l.storefrontAddress?.addressLines ?? []), l.storefrontAddress?.locality].filter(Boolean).join(', ')
        found.push({ account: account.name, location: l.name, title: l.title ?? l.name, address: address || null })
      }
      pageToken = page.nextPageToken
    } while (pageToken)
  }
  return found
}

/** accounts/1 + locations/2 -> the v4 path every reviews call hangs off. */
function reviewsPath(account: string, location: string): string {
  return `/v4/${account}/${location}/reviews`
}

/**
 * Imports the clinic's Google reviews into `reviews`: new ones inserted,
 * known ones updated where Google's copy changed (an edited rating, a reply
 * written on Google directly). A reply already recorded here is kept: it is
 * the one the clinic approved, whatever Google shows.
 */
export async function syncGoogleReviews(service: SupabaseClient<Database>, accountId: string): Promise<{ imported: number; updated: number }> {
  const { data: account } = await service
    .from('accounts')
    .select('google_business_account, google_business_location')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.google_business_account || !account.google_business_location) return { imported: 0, updated: 0 }

  const accessToken = await googleAccessToken(service, accountId)
  if (!accessToken) return { imported: 0, updated: 0 }

  // Every review, newest first, 50 to a page (Google's maximum). It used to
  // stop at the first page reaching back a year, which on a listing with any
  // history meant 50 reviews and no more: Columnaquiro showed 30 of a much
  // longer record, and an average that was not the one Google shows. The
  // page cap is a guard against a runaway loop, not a budget: 100 pages is
  // 5,000 reviews.
  const MAX_PAGES = 100
  const reviews: GoogleReview[] = []
  // Google's own figures for the whole listing, from the first page: what the
  // listing shows, which an average of the imported rows only approximates.
  let googleRating: number | null = null
  let googleCount: number | null = null
  let pageToken: string | undefined
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const page = await $fetch<{ reviews?: GoogleReview[]; nextPageToken?: string; averageRating?: number; totalReviewCount?: number }>(
      googleUrl('mybusiness.googleapis.com', reviewsPath(account.google_business_account, account.google_business_location)),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        query: { pageSize: 50, orderBy: 'updateTime desc', ...(pageToken ? { pageToken } : {}) },
      },
    )
    if (pages === 0) {
      googleRating = typeof page.averageRating === 'number' ? page.averageRating : null
      googleCount = typeof page.totalReviewCount === 'number' ? page.totalReviewCount : null
    }
    reviews.push(...(page.reviews ?? []))
    pageToken = page.nextPageToken
    if (!pageToken) break
  }
  const listingTotals = { google_rating: googleRating, google_review_count: googleCount }

  const rows = reviews.map(importedReview).filter((r): r is NonNullable<typeof r> => r !== null)
  if (rows.length === 0) {
    await service.from('accounts').update({ google_reviews_synced_at: new Date().toISOString(), ...listingTotals }).eq('id', accountId)
    return { imported: 0, updated: 0 }
  }

  // Not an upsert: reviews_platform_external_idx is partial (external_id is
  // null for a review typed in by hand), and PostgREST cannot name a partial
  // index as the conflict target. Every known Google review is read rather
  // than filtered by id: hundreds of ids in an `in` filter overflow the
  // request URL.
  const { data: known } = await service
    .from('reviews')
    .select('id, external_id, rating, body, replied_at')
    .eq('account_id', accountId)
    .eq('platform', 'google')
    .not('external_id', 'is', null)
    .limit(10000)
  const byId = new Map((known ?? []).map((k) => [k.external_id, k]))

  let imported = 0
  let updated = 0
  const fresh = rows.filter((r) => !byId.has(r.externalId))
  if (fresh.length) {
    const { error } = await service.from('reviews').insert(
      fresh.map((r) => ({
        account_id: accountId,
        platform: 'google',
        external_id: r.externalId,
        author_name: r.authorName,
        rating: r.rating,
        body: r.body,
        posted_at: r.postedAt,
        ...(r.reply ? { reply_body: r.reply.body, replied_at: r.reply.at } : {}),
      })),
    )
    if (error) throw createError({ statusCode: 500, statusMessage: `Could not store the Google reviews: ${error.message}` })
    imported = fresh.length
  }
  for (const r of rows) {
    const k = byId.get(r.externalId)
    if (!k) continue
    const answeredOnGoogle = !k.replied_at && r.reply
    if (k.rating === r.rating && k.body === r.body && !answeredOnGoogle) continue
    await service
      .from('reviews')
      .update({ rating: r.rating, body: r.body, ...(answeredOnGoogle ? { reply_body: r.reply!.body, replied_at: r.reply!.at, draft_body: null, draft_created_at: null } : {}), updated_at: new Date().toISOString() })
      .eq('id', k.id)
    updated++
  }

  await service.from('accounts').update({ google_reviews_synced_at: new Date().toISOString(), ...listingTotals }).eq('id', accountId)
  return { imported, updated }
}

/** Publishes the reply under the clinic's name on Google. Throws with Google's reason. */
export async function postGoogleReply(service: SupabaseClient<Database>, accountId: string, reviewId: string, text: string): Promise<void> {
  const { data: account } = await service
    .from('accounts')
    .select('google_business_account, google_business_location')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.google_business_account || !account.google_business_location) {
    throw createError({ statusCode: 400, statusMessage: 'Google is not connected. Connect it in Growth > Reputation.' })
  }
  try {
    const accessToken = await googleAccessToken(service, accountId)
    if (!accessToken) throw createError({ statusCode: 400, statusMessage: 'Google is not connected. Connect it in Growth > Reputation.' })
    await $fetch(googleUrl('mybusiness.googleapis.com', `${reviewsPath(account.google_business_account, account.google_business_location)}/${encodeURIComponent(reviewId)}/reply`), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { comment: text },
    })
  } catch (err: any) {
    if (err?.statusCode === 400) throw err
    throw createError({ statusCode: 502, statusMessage: `Google refused the reply: ${googleError(err)}` })
  }
}
