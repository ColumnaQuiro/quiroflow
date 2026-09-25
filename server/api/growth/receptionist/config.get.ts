import { requireGrowth } from '~/server/utils/requireGrowth'
import { loadReceptionistConfig, loadTypeChoices } from '~/server/utils/receptionist'

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)
  const config = await loadReceptionistConfig(supabase, teamMember.account_id)

  // Channel status is read from where it actually lives rather than stored
  // twice. A second copy would say "connected" the day after someone's
  // WhatsApp session expired.
  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token, instagram_user_id, instagram_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()

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
  }
})
