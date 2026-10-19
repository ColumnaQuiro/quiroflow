import { serverSupabaseServiceRole } from '#supabase/server'
import { receptionistIncludedBy, requireReceptionist } from '~/server/utils/requireGrowth'
import { loadReceptionistActivity } from '~/server/utils/receptionistActivity'
import { loadReceptionistConfig, loadTypeChoices } from '~/server/utils/receptionist'
import { repliesThisMonth } from '~/server/utils/receptionistUsage'

export default defineEventHandler(async (event) => {
  const { supabase, teamMember, subscription } = await requireReceptionist(event)
  const config = await loadReceptionistConfig(supabase, teamMember.account_id)

  // Channel status is read from where it actually lives rather than stored
  // twice. A second copy would say "connected" the day after someone's
  // WhatsApp session expired.
  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token, instagram_user_id, instagram_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  await withMessagingTokens(teamMember.account_id, account)

  const whatsappReady = Boolean(account?.whatsapp_phone_number_id && account?.whatsapp_access_token)
  // Receiving needs only the account id -- the webhook is shared with
  // WhatsApp and verified by the same app secret. The token is what replying
  // needs, so an account id alone is a real, working, half-connected state
  // and is reported as connected rather than as nothing.
  const instagramReady = Boolean(account?.instagram_user_id)

  return {
    config,
    ...(await loadTypeChoices(supabase, teamMember.account_id, config)),
    channels: [
      {
        key: 'whatsapp',
        name: 'WhatsApp',
        status: whatsappReady ? 'connected' : 'not_set_up',
        statusLabel: whatsappReady ? 'Connected' : 'Not set up',
      },
      // Instagram is built. This said "Not available yet" for a day after it
      // shipped, while an Instagram lead sat in the Inbox -- a screen telling
      // an owner their clinic cannot do something it is doing.
      {
        key: 'instagram',
        name: 'Instagram DM',
        status: instagramReady ? 'connected' : 'not_set_up',
        statusLabel: instagramReady ? 'Connected' : 'Not set up',
      },
      // Stated as not built rather than omitted: an owner comparing this
      // screen to what they were sold should see which channels exist.
      { key: 'sms', name: 'SMS', status: 'not_built', statusLabel: 'Not available yet' },
      { key: 'web-chat', name: 'Web chat', status: 'not_built', statusLabel: 'Not available yet' },
    ],
    testModelAvailable: Boolean(useRuntimeConfig().anthropicApiKey),
    // Why the clinic has it (Growth, the add-on, a trial), for the header.
    includedBy: receptionistIncludedBy(subscription),
    // This month's replies, for the usage card and its warnings.
    repliesThisMonth: await repliesThisMonth(supabase, teamMember.account_id),
    // What it has done, for the Overview (server/utils/receptionistActivity.ts).
    // In this response rather than a route of its own: one more file under
    // server/api tips Nitro's typed route map into TS2589 ("excessively
    // deep") in an unrelated $fetch call, as it did for #791.
    activity: await loadReceptionistActivity(serverSupabaseServiceRole(event), teamMember.account_id),
  }
})
