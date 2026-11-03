import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Forgets the saved Quirocitas connection, password and session included.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { error } = await admin
    .from('account_secrets')
    .delete()
    .eq('account_id', teamMember.account_id)
    .in('name', ['quirocitas_base_url', 'quirocitas_username', 'quirocitas_password', 'quirocitas_session', 'quirocitas_ledger_cursor'])
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true }
})
