import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'
import { metaErrorMessage } from '~/server/utils/metaLeadAds'

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

interface PageAccount {
  id: string
  name?: string
  access_token?: string
  instagram_business_account?: { id: string; username?: string }
}

export default defineEventHandler(async (event) => {
  // The same permission as the rest of Settings > WhatsApp, where the
  // Instagram section lives.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  const body = await readBody<{ code?: string }>(event)
  const code = (body?.code ?? '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required.' })

  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const appSecret = config.metaPlatformAppSecret
  const GRAPH = config.metaGraphBaseUrl
  if (!appId || !appSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Instagram connect is not configured on this deployment.' })
  }

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

  // 3. The Pages this grant covers, and the Instagram account behind each.
  let pages: PageAccount[]
  try {
    const listed = await $fetch<{ data?: PageAccount[] }>(`${GRAPH}/me/accounts`, {
      query: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100', access_token: token },
    })
    pages = (listed.data ?? []).filter((p) => p.id && p.access_token && p.instagram_business_account?.id)
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: `Could not read the Pages on that connection: ${metaErrorMessage(err)}` })
  }
  if (pages.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'That connection did not include an Instagram professional account. Run through it again and tick your Instagram account and the Facebook Page it is linked to.',
    })
  }
  // One clinic, one Instagram account: instagram_user_id is a single column,
  // and it routes every DM. Picking the first of several -- which is what
  // WhatsApp does with phone numbers -- would here mean answering one
  // account's DMs while another's went unread, with nothing on screen to say
  // which. So ask instead of guessing.
  if (pages.length > 1) {
    const names = pages.map((p) => `@${p.instagram_business_account!.username ?? p.instagram_business_account!.id}`).join(', ')
    throw createError({
      statusCode: 400,
      statusMessage: `That connection included more than one Instagram account (${names}). Run through it again and tick only the one this clinic uses.`,
    })
  }
  const page = pages[0]
  const igUserId = page.instagram_business_account!.id
  const username = page.instagram_business_account!.username ?? null

  // 4. Is that Instagram account already another clinic's? Checked before
  //    anything with a side effect: the webhook routes a DM to the one account
  //    holding the id, so a second claim would not share DMs, it would take
  //    them. Service role, because the answer has to cover every account --
  //    and it says only "taken", not by whom.
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: claimants, error: claimError } = await admin
    .from('accounts')
    .select('id')
    .eq('instagram_user_id', igUserId)
    .neq('id', teamMember.account_id)
    .limit(1)
  if (claimError) throw createError({ statusCode: 500, statusMessage: claimError.message })
  if (claimants && claimants.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'That Instagram account is already connected to another QuiroFlow account. Disconnect it there first.',
    })
  }

  // 5. Subscribe this app to the Page's messages. The app-level Instagram
  //    webhook is not enough on its own, and its absence is silent: an
  //    unsubscribed Page simply never delivers. This is the step that was
  //    missing for two hours when Columnaquiro's DMs were first set up by hand.
  try {
    await $fetch(`${GRAPH}/${page.id}/subscribed_apps`, {
      method: 'POST',
      query: { subscribed_fields: 'messages', access_token: page.access_token },
    })
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: `Could not subscribe to that account's messages: ${metaErrorMessage(err)}` })
  }

  // 6. Store it: the id on accounts, where the webhook looks it up, and the
  //    Page token in account_secrets, where no staff member can read it.
  const { error } = await admin.from('accounts').update({ instagram_user_id: igUserId }).eq('id', teamMember.account_id)
  if (error) {
    // The check in step 4 is not a lock. accounts_instagram_user_id_key is
    // what settles two clinics in the dialog at once.
    if (error.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'That Instagram account was connected to another QuiroFlow account a moment ago. Disconnect it there first.',
      })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
  await setAccountSecret(admin, teamMember.account_id, 'instagram_access_token', page.access_token!)

  return { connected: true, instagramUserId: igUserId, username, pageName: page.name ?? null }
})
