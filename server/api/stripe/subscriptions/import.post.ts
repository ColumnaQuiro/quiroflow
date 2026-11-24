import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { syncStripeSubscription, type StripeSyncResult } from '~/server/utils/stripeMembershipSync'

// Pairs subscriptions from the import screen: each with the patient a person
// chose, or with a new patient made from the Stripe customer (patientId
// null). Each subscription is read from the clinic's Stripe again, so what is
// written is what Stripe says now. A handful per call, so the page can show
// progress and no call outruns the function's time limit.
const MAX_PER_CALL = 20

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'billing_config')
  const body = await readBody<{ items?: { subscriptionId: string; patientId: string | null }[] }>(event)
  const items = (body?.items ?? []).filter((i) => typeof i?.subscriptionId === 'string' && i.subscriptionId.startsWith('sub_'))
  if (!items.length) throw createError({ statusCode: 400, statusMessage: 'items are required' })
  if (items.length > MAX_PER_CALL) throw createError({ statusCode: 400, statusMessage: `At most ${MAX_PER_CALL} at a time` })

  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await admin.from('accounts').select('stripe_connect_account_id').eq('id', accountId).maybeSingle()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  const { stripe, options } = await stripeClientFor(event, accountId, account)

  const results: ({ subscriptionId: string } & (StripeSyncResult | { outcome: 'error'; message: string }))[] = []
  for (const item of items) {
    try {
      const sub = await stripe.subscriptions.retrieve(item.subscriptionId, { expand: ['customer'] }, options)
      const result = await syncStripeSubscription(admin, accountId, sub, { mode: 'manual', patientId: item.patientId, memberId: teamMember.id })
      results.push({ subscriptionId: item.subscriptionId, ...result })
    } catch (err) {
      const message = (err as { statusMessage?: string }).statusMessage ?? (err as Error).message
      results.push({ subscriptionId: item.subscriptionId, outcome: 'error', message })
    }
  }
  return { results }
})
