import { serverSupabaseServiceRole } from '#supabase/server'
import { setAccountSecret } from '~/server/utils/accountSecrets'
import type { Database } from '~/types/database.types'

// Finishes Embedded Signup: the clinic has just clicked through Meta's own
// dialog, granted this app access to a WhatsApp Business Account they own (or
// created one in the dialog), and the browser has been handed a short-lived
// code. This turns that code into a working connection.
//
// There is deliberately no matching `start` endpoint. Embedded Signup is not
// a redirect OAuth flow like Stripe Connect's -- it is an FB.login() popup,
// and everything the browser needs to open it (app id, configuration id) is
// public runtime config it can read directly. Adding a server round trip
// before the popup would buy nothing and give the CSRF nonce nowhere useful
// to live, since the code never travels through a redirect we own.
//
// What the clinic ends up with is a BUSINESS token, not a user token: Tech
// Providers use those exclusively, they are not tied to the person who
// happened to click, and they do not expire when that person leaves.

interface DebugTokenResponse {
  data?: {
    granular_scopes?: { scope: string; target_ids?: string[] }[]
  }
}

interface PhoneNumbersResponse {
  data?: { id: string; display_phone_number?: string; verified_name?: string }[]
}

interface PhoneNumberPlatform {
  is_on_biz_app?: boolean
  platform_type?: string
}

export default defineEventHandler(async (event) => {
  // The same permission that gates the rest of Settings > WhatsApp. Connecting
  // an account is not a bigger act than pasting the tokens by hand was.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  // businessApp: the clinic chose to keep the number on the WhatsApp Business
  // app (Coexistence). Only what they ASKED for -- whether the number really
  // stayed on the app is read from Meta below.
  const body = await readBody<{ code?: string; businessApp?: boolean }>(event)
  const code = (body?.code ?? '').trim()
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'code is required.' })
  }

  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const appSecret = config.metaPlatformAppSecret
  const GRAPH = config.metaGraphBaseUrl
  if (!appId || !appSecret) {
    throw createError({ statusCode: 500, statusMessage: 'WhatsApp connect is not configured on this deployment.' })
  }

  // 1. Code -> business token. Server-to-server, because it needs the app
  //    secret; this is the only step the browser could not have done itself
  //    and the reason this endpoint exists.
  let businessToken: string
  try {
    const exchanged = await $fetch<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
      query: { client_id: appId, client_secret: appSecret, code },
    })
    businessToken = exchanged.access_token
  } catch (err: any) {
    // Meta's error body is more useful than the status, and a clinic staring
    // at a failed Connect button has no other way to see it.
    const detail = err?.data?.error?.message ?? err?.message ?? 'unknown error'
    throw createError({ statusCode: 502, statusMessage: `Meta refused the authorization code: ${detail}` })
  }

  // 2. Which WhatsApp Business Account did they actually grant? Read it from
  //    the token itself rather than from anything the browser sent.
  //
  //    This matters: the popup also hands the client a waba_id, and trusting
  //    that would let a signed-in staff member POST some OTHER clinic's WABA
  //    id and point our webhook routing at it. The token's granular scopes
  //    are Meta's own answer to "what was this granted for", and cannot be
  //    chosen by the caller.
  let wabaId: string | undefined
  try {
    const debug = await $fetch<DebugTokenResponse>(`${GRAPH}/debug_token`, {
      query: { input_token: businessToken, access_token: `${appId}|${appSecret}` },
    })
    const scopes = debug.data?.granular_scopes ?? []
    wabaId = scopes.find((s) => s.scope === 'whatsapp_business_management')?.target_ids?.[0] ?? scopes.find((s) => s.scope === 'whatsapp_business_messaging')?.target_ids?.[0]
  } catch (err: any) {
    const detail = err?.data?.error?.message ?? err?.message ?? 'unknown error'
    throw createError({ statusCode: 502, statusMessage: `Could not read what this connection grants: ${detail}` })
  }
  if (!wabaId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That connection did not include a WhatsApp Business Account. Please run through the connect flow again and pick one.',
    })
  }

  // 3. The phone number to send from.
  let phoneNumberId: string | undefined
  let displayPhoneNumber: string | null = null
  try {
    const phones = await $fetch<PhoneNumbersResponse>(`${GRAPH}/${wabaId}/phone_numbers`, {
      query: { access_token: businessToken },
    })
    // First one, and only one is expected at this point: a clinic connecting
    // for the first time has exactly one. A clinic with several gets the
    // first and can change it in Settings -- better than refusing the whole
    // connection over an ambiguity most accounts will never have.
    const first = phones.data?.[0]
    phoneNumberId = first?.id
    displayPhoneNumber = first?.display_phone_number ?? null
  } catch (err: any) {
    const detail = err?.data?.error?.message ?? err?.message ?? 'unknown error'
    throw createError({ statusCode: 502, statusMessage: `Could not read the WhatsApp numbers on that account: ${detail}` })
  }
  if (!phoneNumberId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That WhatsApp Business Account has no phone number yet. Add one in the connect flow, then try again.',
    })
  }

  // 4. Is that number already somebody else's?
  //
  //    Checked here, before anything with a side effect: a phone number id
  //    routes inbound messages to exactly one account, and the webhook finds
  //    that account with .maybeSingle(), which returns NULL -- not the first
  //    row -- when two match. A collision therefore does not misroute inbound
  //    WhatsApp, it stops it dead for BOTH clinics, while each one's Settings
  //    page still shows a correct-looking configuration. Nothing is logged and
  //    nothing looks wrong, which is why it has to be refused rather than
  //    reported afterwards.
  //
  //    Service role deliberately: the answer must cover every account, not the
  //    ones this caller can see. It returns no more than whether the number is
  //    taken -- not by whom, which is another clinic's business.
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: claimants, error: claimError } = await admin
    .from('accounts')
    .select('id')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .neq('id', teamMember.account_id)
    .limit(1)
  if (claimError) {
    throw createError({ statusCode: 500, statusMessage: claimError.message })
  }
  if (claimants && claimants.length > 0) {
    console.error(
      `[meta-connect] account ${teamMember.account_id} tried to connect WhatsApp phone number id ${phoneNumberId}, ` +
        `already held by account ${claimants[0].id}. Refused -- connecting both would have silently stopped inbound for both.`,
    )
    throw createError({
      statusCode: 409,
      statusMessage:
        'That WhatsApp number is already connected to another QuiroFlow account. Disconnect it there first, or pick a different number -- connecting it twice would stop incoming messages for both.',
    })
  }

  // 4b. Is the number still on the WhatsApp Business app (Coexistence)?
  //
  //     Meta's answer, not the browser's: the dialog can end up onboarding the
  //     number the standard way whatever was asked, and the two need different
  //     things from us afterwards. Only asked when Coexistence was asked for --
  //     a standard connection is never on the app -- and a failure to ask
  //     falls back to the request rather than failing a connection that worked.
  let onBusinessApp = false
  if (body?.businessApp === true) {
    try {
      const platform = await $fetch<PhoneNumberPlatform>(`${GRAPH}/${phoneNumberId}`, {
        query: { fields: 'is_on_biz_app,platform_type', access_token: businessToken },
      })
      onBusinessApp = platform.is_on_biz_app === true
    } catch (err: any) {
      const detail = err?.data?.error?.message ?? err?.message ?? 'unknown error'
      console.warn(`[meta-connect] could not read is_on_biz_app for ${phoneNumberId} (${detail}); taking the clinic's word that it stays on the app.`)
      onBusinessApp = true
    }
  }

  // 5. Subscribe THIS app to THAT account's webhooks.
  //
  //    Easy to skip and impossible to notice: the app-level webhook
  //    configuration is not enough on its own, and without this call nothing
  //    inbound ever arrives -- silently, because an unrecognised delivery is
  //    dropped rather than logged. This is the same two-level subscription
  //    that cost two hours on the Instagram side, where the Page-level
  //    POST /{page-id}/subscribed_apps was the missing half.
  try {
    await $fetch(`${GRAPH}/${wabaId}/subscribed_apps`, { method: 'POST', query: { access_token: businessToken } })
  } catch (err: any) {
    const detail = err?.data?.error?.message ?? err?.message ?? 'unknown error'
    throw createError({ statusCode: 502, statusMessage: `Connected, but could not subscribe to incoming messages: ${detail}` })
  }

  // 6. Store it. Service role because accounts.whatsapp_access_token is a
  //    credential, and the same reasoning as whatsapp/app-secret.post.ts: the
  //    write goes through a route that can validate, not a direct table
  //    update from the page.
  const { error } = await admin
    .from('accounts')
    .update({
      whatsapp_business_account_id: wabaId,
      whatsapp_phone_number_id: phoneNumberId,
      // Cleared on a standard (re)connection, so the card does not go on
      // telling a clinic its phone still works after the number left the app.
      whatsapp_business_app_since: onBusinessApp ? new Date().toISOString() : null,
    })
    .eq('id', teamMember.account_id)

  if (error) {
    // The check in step 4 is not a lock, and two clinics can be in the dialog
    // at once. accounts_whatsapp_phone_number_id_key is what actually settles
    // it; this turns the loser's raw constraint error into the same answer the
    // check above would have given, rather than a 500 nobody can act on.
    if (error.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage:
          'That WhatsApp number was connected to another QuiroFlow account a moment ago. Disconnect it there first, or pick a different number.',
      })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  // The token in account_secrets, not on accounts, where every member of the
  // clinic could read it.
  await setAccountSecret(admin, teamMember.account_id, 'whatsapp_access_token', businessToken)

  // No app secret is stored, and that is the point: a clinic connected this
  // way has no Meta app of its own. Its webhooks verify against the platform
  // secret in webhookMayActOnAccount, which is why that falls back to the
  // per-account row rather than requiring one.

  // 7. Coexistence only: ask Meta for the chats already on the phone.
  //
  //    Meta allows this once, and only within 24 hours of onboarding -- after
  //    that the number has to be disconnected and connected again to get it.
  //    So it is asked for here, as part of connecting, rather than left to a
  //    button someone may not press in time. The clinic still decides: the app
  //    asks them whether to share, and a refusal arrives as a history webhook
  //    with error 2593109. What does arrive is imported by the webhook
  //    (importWhatsAppHistory) without acting on any of it.
  //
  //    Contacts (sync_type smb_app_state_sync) are deliberately not asked for:
  //    the phone's address book is friends and suppliers as much as patients,
  //    and nothing here would know which.
  //
  //    Best-effort: the connection already works, and a failed request is not
  //    a reason to tell the clinic it did not.
  let historyRequested = false
  if (onBusinessApp) {
    try {
      await $fetch(`${GRAPH}/${phoneNumberId}/smb_app_data`, {
        method: 'POST',
        query: { access_token: businessToken },
        body: { messaging_product: 'whatsapp', sync_type: 'history' },
      })
      historyRequested = true
    } catch (err: any) {
      const detail = err?.data?.error?.message ?? err?.message ?? 'unknown error'
      console.error(`[meta-connect] account ${teamMember.account_id}: could not request the WhatsApp Business app chat history: ${detail}`)
    }
  }

  return { connected: true, wabaId, phoneNumberId, displayPhoneNumber, businessApp: onBusinessApp, historyRequested }
})
