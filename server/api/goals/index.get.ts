import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { goalsProgress } from '~/server/utils/monthlyGoals'

// The Dashboard's monthly goals: this month's targets and the month so far.
// Owners only, like the targets themselves (monthly_goals' RLS).
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireActiveAccount(event)
  if (!teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner sees the monthly goals.' })
  const month = String(getQuery(event).month ?? '')
  return goalsProgress(serverSupabaseServiceRole<Database>(event), teamMember.account_id, new Date(), /^\d{4}-\d{2}$/.test(month) ? month : undefined)
})
