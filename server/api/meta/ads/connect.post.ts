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

// Meta's account_status: 1 active, 2 disabled, 3 unsettled, 7 pending risk
// review, 8 pending settlement, 9 in grace period, 100 pending closure,
// 101 closed. A closed account has no spend worth reading, and offering it
// beside the live one is how the wrong one gets picked.
const CLOSED = new Set([100, 101])

export default defineEventHandler(async (event) => {
  // The page this lives on (Settings > Leads) is gated on the same
  // permission, and accounts_settings_permission puts meta_ads_* under it.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  const body = await readBody<{ code?: string; ticket?: string; adAccountId?: string }>(event)
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
    try {
      const exchanged = await $fetch<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
        query: { client_id: appId, client_secret: appSecret, code },
      })
      token = exchanged.access_token
    } catch (err) {
      throw createError({ statusCode: 502, statusMessage: `Meta refused the authorization code: ${metaErrorMessage(err)}` })
    }

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
    let accounts: AdAccount[]
    try {
      const listed = await $fetch<{ data?: AdAccount[] }>(`${GRAPH}/me/adaccounts`, {
        query: { fields: 'id,account_id,name,currency,account_status', limit: '100', access_token: token },
      })
      accounts = (listed.data ?? []).filter((a) => a.id && !CLOSED.has(a.account_status ?? 1))
    } catch (err) {
      throw createError({ statusCode: 502, statusMessage: `Could not read the ad accounts on that connection: ${metaErrorMessage(err)}` })
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
