import { requirePermission } from '~/server/utils/requirePermission'
import { loadReceptionistConfig } from '~/server/utils/receptionist'

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const config = await loadReceptionistConfig(supabase, teamMember.account_id)

  // Channel status is read from where it actually lives rather than stored
  // twice. A second copy would say "connected" the day after someone's
  // WhatsApp session expired.
  const { data: account } = await supabase
    .from('accounts')
    .select('whatsapp_phone_number_id, whatsapp_access_token')
    .eq('id', teamMember.account_id)
    .maybeSingle()

  const whatsappReady = Boolean(account?.whatsapp_phone_number_id && account?.whatsapp_access_token)

  return {
    config,
    channels: [
      {
        name: 'WhatsApp',
        status: whatsappReady ? 'connected' : 'not_set_up',
        statusLabel: whatsappReady ? 'Connected' : 'Not set up',
      },
      // Stated as not built rather than omitted: an owner comparing this
      // screen to what they were sold should see which channels exist.
      { name: 'SMS', status: 'not_built', statusLabel: 'Not available yet' },
      { name: 'Web chat', status: 'not_built', statusLabel: 'Not available yet' },
      { name: 'Instagram DM', status: 'not_built', statusLabel: 'Not available yet' },
    ],
    testModelAvailable: Boolean(useRuntimeConfig().anthropicApiKey),
  }
})
