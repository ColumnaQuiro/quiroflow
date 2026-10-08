import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loose } from '~/server/utils/publicApiHandlers'
import { metaErrorMessage } from '~/server/utils/metaLeadAds'

// Finishes connecting a clinic's Facebook Page(s) for lead ads. The browser
// has just been through Meta's Login for Business dialog (the lead ads
// configuration, not WhatsApp's) and holds a short-lived code.
//
// Which Pages are connected is decided in that dialog, not here: the clinic
// ticks the Pages it wants to share, and those are exactly the ones the token
// can see. Every one of them is connected -- there is no second "pick a Page"
// step, because the dialog already was one.
//
// Per Page, in this order, and nothing is stored for a Page until every step
// for it has worked: a stored token with no webhook subscription would read
// as "Connected" in Settings while no lead ever arrived.

interface PageAccount {
  id: string
  name?: string
  access_token?: string
}

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  const body = await readBody<{ code?: string }>(event)
  const code = (body?.code ?? '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required.' })

  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const appSecret = config.metaPlatformAppSecret
  const GRAPH = config.metaGraphBaseUrl
  if (!appId || !appSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Facebook lead ads are not configured on this deployment.' })
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

  // 2. A long-lived token, when this is a user token. A Page token read with
  //    a long-lived user token does not expire; one read with the short-lived
  //    token from step 1 dies within hours, and the connection with it -- a
  //    day later, silently. A system-user token is already permanent and Meta
  //    refuses to exchange it, which is fine: keep what we have.
  try {
    const longLived = await $fetch<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
      query: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token },
    })
    if (longLived.access_token) token = longLived.access_token
  } catch {
    // Not a user token. Nothing to do.
  }

  // 3. The Pages this grant covers, each with its own Page token.
  let pages: PageAccount[]
  try {
    const listed = await $fetch<{ data?: PageAccount[] }>(`${GRAPH}/me/accounts`, {
      query: { fields: 'id,name,access_token', limit: '100', access_token: token },
    })
    pages = (listed.data ?? []).filter((p) => p.id && p.access_token)
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: `Could not read the Pages on that connection: ${metaErrorMessage(err)}` })
  }
  if (pages.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That connection did not include a Facebook Page. Run through it again and tick the Page your lead ads run on.',
    })
  }

  // 4. Pages already connected to ANOTHER clinic are refused. page_id routes
  //    every lead to one account, so connecting it twice would leave the
  //    first clinic's leads arriving somewhere else. Service role, because
  //    the answer has to cover every account -- and it says only "taken".
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: claimed, error: claimError } = await loose(admin)
    .from('lead_ad_pages')
    .select('page_id')
    .in('page_id', pages.map((p) => p.id))
    .neq('account_id', teamMember.account_id)
  if (claimError) throw createError({ statusCode: 500, statusMessage: claimError.message })
  const takenIds = new Set(((claimed ?? []) as { page_id: string }[]).map((r) => r.page_id))

  const connected: { id: string; name: string | null }[] = []
  const refused: { id: string; name: string | null; reason: string }[] = []

  for (const page of pages) {
    const name = page.name ?? null
    if (takenIds.has(page.id)) {
      refused.push({ id: page.id, name, reason: 'Already connected to another QuiroFlow account.' })
      continue
    }

    // 5. Subscribe this app to the Page's leadgen field. The app-level
    //    webhook is not enough on its own -- the same two-level subscription
    //    as Instagram's DMs and WhatsApp's WABA.
    try {
      await $fetch(`${GRAPH}/${page.id}/subscribed_apps`, {
        method: 'POST',
        query: { subscribed_fields: 'leadgen', access_token: page.access_token },
      })
    } catch (err) {
      refused.push({ id: page.id, name, reason: `Could not subscribe to its leads: ${metaErrorMessage(err)}` })
      continue
    }

    // 6. Store it. Insert, and on a clash update only OUR row: an upsert
    //    would rewrite account_id, handing the Page to whichever clinic got
    //    there second if two were in the dialog at once. Reconnecting leaves
    //    connected_at alone, which is what the catch-up sweep counts back
    //    from.
    const fields = { page_name: name, connected_by: teamMember.id, last_error: null, last_error_at: null }
    const { error: insertError } = await loose(admin)
      .from('lead_ad_pages')
      .insert({ account_id: teamMember.account_id, page_id: page.id, ...fields } as never)
    if (insertError) {
      if (insertError.code !== '23505') {
        refused.push({ id: page.id, name, reason: insertError.message })
        continue
      }
      const { data: ours } = await loose(admin)
        .from('lead_ad_pages')
        .update(fields as never)
        .eq('page_id', page.id)
        .eq('account_id', teamMember.account_id)
        .select('page_id')
      if (!ours?.length) {
        refused.push({ id: page.id, name, reason: 'Already connected to another QuiroFlow account.' })
        continue
      }
    }
    const { error: tokenError } = await loose(admin)
      .from('lead_ad_page_tokens')
      .upsert({ page_id: page.id, account_id: teamMember.account_id, access_token: page.access_token, updated_at: new Date().toISOString() } as never, {
        onConflict: 'page_id',
      })
    if (tokenError) {
      // A Page row with no token would say "Connected" and receive nothing.
      await loose(admin).from('lead_ad_pages').delete().eq('page_id', page.id).eq('account_id', teamMember.account_id)
      refused.push({ id: page.id, name, reason: tokenError.message })
      continue
    }
    connected.push({ id: page.id, name })
  }

  if (connected.length === 0) {
    throw createError({
      statusCode: refused.every((r) => r.reason.startsWith('Already connected')) ? 409 : 502,
      statusMessage: refused.map((r) => `${r.name ?? r.id}: ${r.reason}`).join(' '),
    })
  }

  return { connected, refused }
})
