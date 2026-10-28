import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'
import { metaErrorMessage } from '~/server/utils/metaLeadAds'
import { decryptSecret, encryptSecret } from '~/server/utils/verifactuCertificate'

// Finishes connecting a clinic's Instagram professional account for DMs. The
// browser has just been through Meta's Login for Business dialog -- the
// Instagram configuration, not WhatsApp's or lead ads' -- and holds a
// short-lived code.
//
// Instagram messaging with Facebook Login works through the Facebook Page the
// Instagram account is linked to: the Page token is what sends
// (instagramSend.ts posts to graph.facebook.com with it), and the Page's
// webhook subscription is what makes DMs arrive. So this is the lead-ads flow
// with a different question at the end: not "which Pages" but "which
// Instagram account sits behind the Page you ticked".
//
// Nothing is stored until every step has worked. An Instagram id with no
// Page subscription behind it reads as "Receiving only" in Settings while
// nothing ever arrives, which is worse than not being connected at all.
//
// Called twice when the answer is ambiguous: first with { code }, which may
// come back as { choose, ticket } instead of a connection; then with
// { ticket, instagramUserId } once the clinic has picked.

interface PageAccount {
  id: string
  name?: string
  access_token?: string
  instagram_business_account?: { id: string; username?: string }
}

interface DebugTokenResponse {
  data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] }
}

/** One Instagram account the clinic could mean, with what connecting it needs. */
interface Candidate {
  instagramUserId: string
  username: string | null
  pageId: string
  pageName: string | null
  pageToken: string
}

/** What a ticket holds between the two calls. Encrypted: it carries Page tokens. */
interface Ticket {
  accountId: string
  expiresAt: number
  candidates: Candidate[]
}

// Long enough to read three @handles and click one, short enough that a
// ticket left in a tab is dead by the time anyone could find it.
const TICKET_LIFETIME_MS = 10 * 60 * 1000

// Its own key, derived from the platform app secret rather than reusing that
// secret (or VeriFactu's key) as-is: a ticket must not be decryptable with a
// key that means something else.
function ticketKey(appSecret: string): string {
  return createHash('sha256').update(`quiroflow:instagram-connect-ticket:${appSecret}`).digest('base64')
}

export default defineEventHandler(async (event) => {
  // The same permission as the rest of Settings > WhatsApp, where the
  // Instagram section lives.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  const body = await readBody<{ code?: string; ticket?: string; instagramUserId?: string }>(event)
  const code = (body?.code ?? '').trim()
  const ticket = (body?.ticket ?? '').trim()
  if (!code && !ticket) throw createError({ statusCode: 400, statusMessage: 'code is required.' })

  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const appSecret = config.metaPlatformAppSecret
  const GRAPH = config.metaGraphBaseUrl
  if (!appId || !appSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Instagram connect is not configured on this deployment.' })
  }

  let chosen: Candidate
  if (ticket) {
    // The second call: the clinic picked one of the accounts the first call
    // offered. Only what the ticket names can be picked, and only by the
    // clinic it was issued to -- so a caller cannot slip in an id of their
    // own, and a ticket copied out of one clinic's tab is useless in another.
    let held: Ticket
    try {
      held = JSON.parse(decryptSecret(ticket, ticketKey(appSecret)))
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'That choice could not be read. Click Connect Instagram again.' })
    }
    if (held.accountId !== teamMember.account_id || held.expiresAt < Date.now()) {
      throw createError({ statusCode: 400, statusMessage: 'That choice has expired. Click Connect Instagram again.' })
    }
    const pick = held.candidates.find((c) => c.instagramUserId === (body?.instagramUserId ?? '').trim())
    if (!pick) throw createError({ statusCode: 400, statusMessage: 'Pick one of the Instagram accounts offered.' })
    chosen = pick
  } else {
    // 1. Code -> token, server to server, because it needs the app secret.
    let token: string
    try {
      const exchanged = await $fetch<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
        query: { client_id: appId, client_secret: appSecret, code },
      })
      token = exchanged.access_token
    } catch (err) {
      throw createError({ statusCode: 502, statusMessage: `Meta refused the authorization code: ${metaErrorMessage(err)}` })
    }

    // 2. A long-lived token, when this is a user token -- for the reason
    //    lead-pages/connect gives: a Page token read with the short-lived one
    //    dies within hours, and the replies with it. A system-user token is
    //    already permanent and Meta refuses to exchange it; keep what we have.
    try {
      const longLived = await $fetch<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
        query: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token },
      })
      if (longLived.access_token) token = longLived.access_token
    } catch {
      // Not a user token. Nothing to do.
    }

    // 3. The Pages this token can see, and the Instagram account behind each.
    let pages: PageAccount[]
    try {
      const listed = await $fetch<{ data?: PageAccount[] }>(`${GRAPH}/me/accounts`, {
        query: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100', access_token: token },
      })
      pages = (listed.data ?? []).filter((p) => p.id && p.access_token && p.instagram_business_account?.id)
    } catch (err) {
      throw createError({ statusCode: 502, statusMessage: `Could not read the Pages on that connection: ${metaErrorMessage(err)}` })
    }

    // 4. ...narrowed to the Instagram accounts this grant is actually FOR.
    //
    //    "The Pages this token can see" is wider than "what the clinic just
    //    ticked". Business login issues one system user per app and business
    //    portfolio, and it keeps every asset any earlier login granted it --
    //    so a clinic that connected its lead ads Page first brings that Page,
    //    and the Instagram account behind it, into this list whatever it
    //    ticks here. The instagram_* scopes name the accounts the messaging
    //    permission was granted for, which is the question being asked.
    //    Best effort: if Meta does not say, every Page counts, and the picker
    //    below sorts out the rest.
    try {
      const debug = await $fetch<DebugTokenResponse>(`${GRAPH}/debug_token`, {
        query: { input_token: token, access_token: `${appId}|${appSecret}` },
      })
      const granted = new Set(
        (debug.data?.granular_scopes ?? []).filter((s) => s.scope === 'instagram_manage_messages' || s.scope === 'instagram_basic').flatMap((s) => s.target_ids ?? []),
      )
      if (granted.size > 0) pages = pages.filter((p) => granted.has(p.instagram_business_account!.id))
    } catch {
      // Not knowing is not a reason to refuse; the picker handles it.
    }

    if (pages.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'That connection did not include an Instagram professional account. Run through it again and tick your Instagram account and the Facebook Page it is linked to.',
      })
    }

    const candidates: Candidate[] = pages.map((p) => ({
      instagramUserId: p.instagram_business_account!.id,
      username: p.instagram_business_account!.username ?? null,
      pageId: p.id,
      pageName: p.name ?? null,
      pageToken: p.access_token!,
    }))

    // One clinic, one Instagram account: instagram_user_id is a single
    // column, and it routes every DM. Picking the first of several -- which
    // is what WhatsApp does with phone numbers -- would here mean answering
    // one account's DMs while another's went unread. So the clinic picks.
    // Nothing has been subscribed or stored yet; the tokens wait, encrypted,
    // in the ticket the second call brings back.
    if (candidates.length > 1) {
      const sealed: Ticket = { accountId: teamMember.account_id, expiresAt: Date.now() + TICKET_LIFETIME_MS, candidates }
      return {
        connected: false,
        choose: candidates.map(({ instagramUserId, username, pageName }) => ({ instagramUserId, username, pageName })),
        ticket: encryptSecret(JSON.stringify(sealed), ticketKey(appSecret)),
      }
    }
    chosen = candidates[0]
  }

  // 5. Is that Instagram account already another clinic's? Checked before
  //    anything with a side effect: the webhook routes a DM to the one account
  //    holding the id, so a second claim would not share DMs, it would take
  //    them. Service role, because the answer has to cover every account --
  //    and it says only "taken", not by whom.
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: claimants, error: claimError } = await admin
    .from('accounts')
    .select('id')
    .eq('instagram_user_id', chosen.instagramUserId)
    .neq('id', teamMember.account_id)
    .limit(1)
  if (claimError) throw createError({ statusCode: 500, statusMessage: claimError.message })
  if (claimants && claimants.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'That Instagram account is already connected to another QuiroFlow account. Disconnect it there first.',
    })
  }

  // 6. Subscribe this app to the Page's messages. The app-level Instagram
  //    webhook is not enough on its own, and its absence is silent: an
  //    unsubscribed Page simply never delivers. This is the step that was
  //    missing for two hours when Columnaquiro's DMs were first set up by hand.
  //    It needs pages_messaging on the token, not just pages_manage_metadata:
  //    without it Meta answers "(#200) To subscribe to the messages field, one
  //    of these permissions is needed: pages_messaging", which is what the
  //    first real connection hit.
  try {
    await $fetch(`${GRAPH}/${chosen.pageId}/subscribed_apps`, {
      method: 'POST',
      query: { subscribed_fields: 'messages', access_token: chosen.pageToken },
    })
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: `Could not subscribe to that account's messages: ${metaErrorMessage(err)}` })
  }

  // 7. Store it: the id on accounts, where the webhook looks it up, and the
  //    Page token in account_secrets, where no staff member can read it.
  const { error } = await admin.from('accounts').update({ instagram_user_id: chosen.instagramUserId }).eq('id', teamMember.account_id)
  if (error) {
    // The check in step 5 is not a lock. accounts_instagram_user_id_key is
    // what settles two clinics in the dialog at once.
    if (error.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'That Instagram account was connected to another QuiroFlow account a moment ago. Disconnect it there first.',
      })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
  await setAccountSecret(admin, teamMember.account_id, 'instagram_access_token', chosen.pageToken)

  return { connected: true, instagramUserId: chosen.instagramUserId, username: chosen.username, pageName: chosen.pageName }
})
