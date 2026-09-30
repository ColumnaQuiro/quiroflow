import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// How many patients an announcement would reach, counted the way
// sendPushToPatients picks them (server/utils/pushNotifications.ts) and with
// the same permission as sending. Settings > Mobile App used to count through
// the staff member's own RLS, so someone who sees only their own patients was
// told a smaller number than the send then went to.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'communication_config')
  const { count, error } = await serverSupabaseServiceRole<Database>(event)
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', teamMember.account_id)
    .not('user_id', 'is', null)
    .eq('do_not_contact', false)
    .eq('app_push_opted_out', false)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { patients: count ?? 0 }
})
