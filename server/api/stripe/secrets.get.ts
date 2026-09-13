import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Which Stripe secrets are stored -- never the values. The settings page needs
// to show a "stored" placeholder against each field without the value ever
// being fetchable through an API, which is the whole reason they moved out of
// `accounts`.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  const admin = serverSupabaseServiceRole<Database>(event)
  return await accountSecretStatus(admin, teamMember.account_id)
})
