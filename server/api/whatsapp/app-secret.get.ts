import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Whether an app secret is stored -- never the secret itself. The settings page
// needs to show "configured" vs "not configured" without the value ever being
// readable through an API, which is the whole reason it lives in a
// service-role-only table.
//
// Worth surfacing because the webhook fails closed: a clinic letting Meta post
// directly, with no secret stored, silently stops having replies tracked.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'communication_config')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data } = await admin.from('whatsapp_app_secrets').select('updated_at').eq('account_id', teamMember.account_id).maybeSingle()

  return { configured: Boolean(data), updatedAt: data?.updated_at ?? null }
})
