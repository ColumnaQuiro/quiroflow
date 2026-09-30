import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Forgets the saved PracticeHub connection, key included.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { error } = await admin
    .from('accounts')
    .update({ practicehub_base_url: null, practicehub_contact_email: null, practicehub_api_key: null })
    .eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  await admin.from('account_secrets').delete().eq('account_id', teamMember.account_id).eq('name', 'practicehub_api_key')
  return { ok: true }
})
