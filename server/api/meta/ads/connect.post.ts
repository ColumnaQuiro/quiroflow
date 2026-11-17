import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'
import { metaErrorMessage } from '~/server/utils/metaLeadAds'
import { decryptSecret, encryptSecret } from '~/server/utils/verifactuCertificate'

// Finishes connecting a clinic's Meta ad account, so Growth can read what it
// spent instead of somebody typing it each month. The browser has just been
// through Meta's Login for Business dialog -- the Meta Ads configuration,
// which asks for ads_read and nothing else -- and holds a short-lived code.
//
// Reading only. ads_read cannot create, edit or pay for anything, so the
// token this stores is worthless to anyone who wants to spend money.
//
// Called twice when the grant reaches more than one ad account (an agency
// login, or a clinic with an old account beside the live one): first with
// { code }, which comes back as { choose, ticket }; then with
// { ticket, adAccountId } once the clinic has picked. Same shape as
// Instagram's connect, for the same reason: one column, so one account.

interface AdAccount {
  id: string
  account_id?: string
  name?: string
  currency?: string
  account_status?: number
}

interface Candidate {
  /** Without the act_ prefix, as Meta's own account_id field gives it. */
  adAccountId: string
  name: string | null
  currency: string | null
}

/** What a ticket holds between the two calls. Encrypted: it carries the token. */
interface Ticket {
  accountId: string
  expiresAt: number
  token: string
  candidates: Candidate[]
}

const TICKET_LIFETIME_MS = 10 * 60 * 1000

// Its own key, so an Instagram ticket cannot be replayed here or the reverse.
function ticketKey(appSecret: string): string {
  return createHash('sha256').update(`quiroflow:meta-ads-connect-ticket:${appSecret}`).digest('base64')
}

// The JavaScript SDK's own landing page, which it names as redirect_uri when
// it opens the login in a popup (see useFacebookPageConnect).
const SDK_REDIRECT_PREFIX = 'https://staticxx.facebook.com/x/connect/xd_arbiter/'

/**
 * The redirect_uris the browser says a code may be bound to, kept only when
 * each is one of the two a login from this app can really have used: the
 * SDK's own landing page, or this app's root. Nothing else is passed on to
 * Meta, so the endpoint cannot be used to exchange codes issued elsewhere.
 * In the order to try them; at most three.
 */
function allowedRedirectUris(candidates: unknown, host: string): string[] {
  const out: string[] = []
  for (const candidate of Array.isArray(candidates) ? candidates.slice(0, 3) : []) {
    if (typeof candidate !== 'string' || candidate.length > 2000) continue
    if (candidate.startsWith(SDK_REDIRECT_PREFIX)) {
      out.push(candidate)
      continue
    }
    try {
      const url = new URL(candidate)
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      if (url.host !== host || url.pathname !== '/' || url.search || url.hash) continue
      if (url.protocol !== 'https:' && !local) continue
      out.push(`${url.origin}/`)
    } catch {
      // Not a URL; dropped.
    }
  }
  return [...new Set(out)]
}

/**
 * The ad accounts the grant itself names, without the act_ prefix: the
 * target_ids of its ads_read (or ads_management) granular scope. Empty when
 * Meta does not say, which sends the caller to /me/adaccounts instead.
 */
async function grantedAdAccountIds(graph: string, token: string, appToken: string): Promise<{ ids: string[]; seen: string }> {
  try {
    const debug = await $fetch<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(`${graph}/debug_token`, {
      query: { input_token: token, access_token: appToken },
    })
    const scopes = debug.data?.granular_scopes ?? []
    const ids = scopes
      .filter((s) => s.scope === 'ads_read' || s.scope === 'ads_management')
      .flatMap((s) => s.target_ids ?? [])
      .map((id) => id.replace(/^act_/, ''))
    // What was granted, as scope names and how many assets each covers --
    // never a token. Said in the error when no ad account turns up, so a
    // failed connection tells us what Meta handed over instead of leaving
    // it to a guess and another release.
    const seen = scopes.map((s) => `${s.scope}${s.target_ids ? `(${s.target_ids.length})` : ''}`).join(', ') || 'none'
    return { ids: [...new Set(ids)], seen }
  } catch {
    return { ids: [], seen: 'unreadable' }
  }
}

// Meta's account_status: 1 active, 2 disabled, 3 unsettled, 7 pending risk
// review, 8 pending settlement, 9 in grace period, 100 pending closure,
// 101 closed. A closed account has no spend worth reading, and offering it
// beside the live one is how the wrong one gets picked.
const CLOSED = new Set([100, 101])

export default defineEventHandler(async (event) => {
  // The page this lives on (Settings > Leads) is gated on the same
  // permission, and accounts_settings_permission puts meta_ads_* under it.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  const body = await readBody<{ code?: string; ticket?: string; adAccountId?: string; redirectUris?: unknown }>(event)
  const code = (body?.code ?? '').trim()
  const ticket = (body?.ticket ?? '').trim()
  if (!code && !ticket) throw createError({ statusCode: 400, statusMessage: 'code is required.' })

  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const appSecret = config.metaPlatformAppSecret
  const GRAPH = config.metaGraphBaseUrl
  if (!appId || !appSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Meta Ads connect is not configured on this deployment.' })
  }

  let token: string
  let chosen: Candidate
  if (ticket) {
    let held: Ticket
    try {
      held = JSON.parse(decryptSecret(ticket, ticketKey(appSecret)))
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'That choice could not be read. Click Connect Meta Ads again.' })
    }
    if (held.accountId !== teamMember.account_id || held.expiresAt < Date.now()) {
      throw createError({ statusCode: 400, statusMessage: 'That choice has expired. Click Connect Meta Ads again.' })
    }
    const pick = held.candidates.find((c) => c.adAccountId === (body?.adAccountId ?? '').trim().replace(/^act_/, ''))
    if (!pick) throw createError({ statusCode: 400, statusMessage: 'Pick one of the ad accounts offered.' })
    token = held.token
    chosen = pick
  } else {
    // 1. Code -> token, server to server, because it needs the app secret.
    //
    //    A user-token code is only exchanged with the exact redirect_uri the
    //    dialog was opened with, which the browser reads as the SDK opens it
    //    (useFacebookPageConnect). Each allowed candidate is tried in turn --
    //    a refused redirect_uri does not use the code up -- and a code with
    //    none, from a system-user configuration, is tried bare as before.
    //    Stops at the first refusal that is not about the redirect_uri.
    const tries: (string | null)[] = [...allowedRedirectUris(body?.redirectUris, getRequestHost(event)), null]
    let lastError: unknown = null
    let exchangedToken: string | null = null
    for (const redirectUri of tries) {
      try {
        const exchanged = await $fetch<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
          query: { client_id: appId, client_secret: appSecret, code, ...(redirectUri ? { redirect_uri: redirectUri } : {}) },
        })
        exchangedToken = exchanged.access_token
        break
      } catch (err) {
        lastError = err
        if (!/redirect_uri/i.test(metaErrorMessage(err))) break
      }
    }
    if (!exchangedToken) {
      throw createError({ statusCode: 502, statusMessage: `Meta refused the authorization code: ${metaErrorMessage(lastError)}` })
    }
    token = exchangedToken

    // 2. A long-lived token when this is a user token: the short-lived one
    //    dies within hours and spend would stop being read a day later, with
    //    nothing on screen to say so. A system-user token is already
    //    permanent and Meta refuses to exchange it; keep what we have.
    try {
      const longLived = await $fetch<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
        query: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token },
      })
      if (longLived.access_token) token = longLived.access_token
    } catch {
      // Not a user token. Nothing to do.
    }

    // 3. The ad accounts this grant covers.
    //
    //    Asked of the token's own grant first: debug_token's granular_scopes
    //    names the ad accounts ads_read was granted for. Business login
    //    hands out a system-user token, and GET /me/adaccounts on one is
    //    refused with "(#200) Missing Permissions" unless it also carries
    //    business_management -- which is what the first real connection hit,
    //    15 Nov 2026. Asking for business_management to work around that
    //    would be asking for far more than reading spend needs. /me/adaccounts
    //    stays as the fallback, for a user token where it does work.
    let accounts: AdAccount[]
    const granted = await grantedAdAccountIds(GRAPH, token, `${appId}|${appSecret}`)
    if (granted.ids.length > 0) {
      const read = await Promise.all(
        granted.ids.map((id) =>
          $fetch<AdAccount>(`${GRAPH}/act_${id}`, { query: { fields: 'id,account_id,name,currency,account_status', access_token: token } }).catch(
            () => ({ id: `act_${id}`, account_id: id }) as AdAccount,
          ),
        ),
      )
      accounts = read.filter((a) => !CLOSED.has(a.account_status ?? 1))
    } else {
      try {
        const listed = await $fetch<{ data?: AdAccount[] }>(`${GRAPH}/me/adaccounts`, {
          query: { fields: 'id,account_id,name,currency,account_status', limit: '100', access_token: token },
        })
        accounts = (listed.data ?? []).filter((a) => a.id && !CLOSED.has(a.account_status ?? 1))
      } catch (err) {
        throw createError({
          statusCode: 502,
          statusMessage: `Could not read the ad accounts on that connection: ${metaErrorMessage(err)} (granted: ${granted.seen})`,
        })
      }
    }
    if (accounts.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'That connection did not include an ad account. Run through it again and tick the ad account your ads run on.',
      })
    }

    const candidates: Candidate[] = accounts.map((a) => ({
      adAccountId: (a.account_id ?? a.id).replace(/^act_/, ''),
      name: a.name ?? null,
      currency: a.currency ?? null,
    }))

    if (candidates.length > 1) {
      const sealed: Ticket = { accountId: teamMember.account_id, expiresAt: Date.now() + TICKET_LIFETIME_MS, token, candidates }
      return {
        connected: false,
        choose: candidates,
        ticket: encryptSecret(JSON.stringify(sealed), ticketKey(appSecret)),
      }
    }
    chosen = candidates[0]
  }

  // 4. Store it: the id on accounts, the token in account_secrets where no
  //    staff member can read it. Token first: an id with no token reads as
  //    half-connected, a token with no id as not connected at all.
  const admin = serverSupabaseServiceRole<Database>(event)
  await setAccountSecret(admin, teamMember.account_id, 'meta_ads_access_token', token)
  const { error } = await admin.from('accounts').update({ meta_ads_account_id: chosen.adAccountId }).eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { connected: true, adAccountId: chosen.adAccountId, name: chosen.name, currency: chosen.currency }
})
