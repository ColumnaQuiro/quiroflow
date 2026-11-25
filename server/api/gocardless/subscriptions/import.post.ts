import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { importGoCardlessSubscription } from '~/server/utils/gocardlessSubscriptionImport'

// Settings > Import > Direct debits: books a subscription another app created
// (PracticeHub's, on a clinic moving across) as the patient's membership of
// the plan a person chose, and leaves it collecting exactly as it was. From
// here on its payments are booked by the webhook like any of ours
// (server/utils/gocardlessSubscriptionImport.ts).
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  const body = await readBody<{ subscriptionId?: string; planId?: string }>(event)
  if (!body?.subscriptionId || !body.planId) throw createError({ statusCode: 400, statusMessage: 'subscriptionId and planId are required' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) throw createError({ statusCode: 409, statusMessage: 'GoCardless is not connected' })

  const result = await importGoCardlessSubscription(admin, request, teamMember.account_id, {
    subscriptionId: body.subscriptionId,
    planId: body.planId,
    memberId: teamMember.id,
  })
  return { ok: true, ...result }
})
