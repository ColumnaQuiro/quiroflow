import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The only enforcement of "free trial, then must pay" for an account that
// never got a real Stripe subscription -- signup starts a 14-day trial
// (see 0134_billing_trial_and_enforcement.sql), but if nobody ever runs
// "Start subscription" from the admin panel for that account, there's no
// Stripe object to ever fire a webhook event, so the row would otherwise
// just sit at status='trialing' forever. This is what actually flips it to
// locked once the trial's up. Accounts that DO have a real Stripe
// subscription are left alone entirely -- Stripe's own status (and the
// platform-billing webhook that mirrors it) already governs those.
//
// Same shared-secret-header pattern as birthday-cron.post.ts -- there's no
// session on a pg_cron-fired call, so a pg_cron job (registered directly
// against the production project, not in a migration -- see
// 0081_enable_pg_cron.sql's comment on why) posts here once a day with the
// same X-Cron-Secret already used by every other scheduled job.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: expired, error } = await supabase
    .from('subscriptions')
    .update({ status: 'locked', updated_at: new Date().toISOString() })
    .eq('status', 'trialing')
    .eq('comped', false)
    .is('stripe_subscription_id', null)
    .lt('trial_ends_at', new Date().toISOString())
    .select('account_id')
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { locked: expired?.length ?? 0 }
})
