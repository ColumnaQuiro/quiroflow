import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { BLIND_SPOT_PLAN_ID } from '~/utils/blindSpotPlan'

// Which app the account sees (accounts.product, 20261126082211_blind_spot.sql):
//
//   'blind_spot' -- chosen at sign-up by a clinic that wants only the test.
//                   The trial moves onto the Blind Spot plan, so what it is
//                   offered to buy when the trial ends is that, at its price.
//   'clinic'     -- moving to the whole of QuiroFlow. The tests stay where
//                   they are, on the same patients; while still in the trial
//                   the plan goes back to Solo, and the owner chooses a plan
//                   on the Subscription page as any clinic does.
//
// The owner only, and through the service role: the column is deliberately
// outside accounts_settings_permission(), so nobody else can flip it.
// An account already paying for the Blind Spot plan is not moved here: its
// Stripe subscription has to change plan first, and that is a plan change on
// the Subscription page, not a switch.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireTeamMember(event)
  if (!teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Only the account owner can change this' })

  const body = await readBody<{ product?: string }>(event)
  const product = body?.product
  if (product !== 'blind_spot' && product !== 'clinic') throw createError({ statusCode: 400, statusMessage: 'product must be blind_spot or clinic' })

  const serviceRole = serverSupabaseServiceRole<Database>(event)
  const { data: sub } = await serviceRole
    .from('subscriptions')
    .select('plan_id, status, stripe_subscription_id, comped')
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!sub) throw createError({ statusCode: 404, statusMessage: 'No subscription for this account' })
  const paying = !!sub.stripe_subscription_id && !sub.comped

  if (product === 'blind_spot') {
    if (paying) throw createError({ statusCode: 409, statusMessage: 'This account already pays for a QuiroFlow plan.' })
    await serviceRole.from('subscriptions').update({ plan_id: BLIND_SPOT_PLAN_ID }).eq('account_id', teamMember.account_id)
  } else if (sub.plan_id === BLIND_SPOT_PLAN_ID) {
    if (paying) {
      throw createError({ statusCode: 409, statusMessage: 'Change the plan under Subscription first: this account pays for Blind Spot on its own.' })
    }
    // Solo is only where it starts: once the product below changes, the trial
    // rule (sync_trial_plan, 20261127064737) sizes it to the team, so a
    // clinic of three lands on Practice.
    await serviceRole.from('subscriptions').update({ plan_id: 'starter' }).eq('account_id', teamMember.account_id)
  }

  const { error } = await serviceRole.from('accounts').update({ product } as never).eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: 'Could not change the product' })
  return { product }
})
