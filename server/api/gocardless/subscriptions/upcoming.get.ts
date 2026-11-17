import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// When each of a patient's direct-debit memberships is next collected, for
// the line on their Money tab. Read from GoCardless as the tab opens rather
// than stored: the date moves with every collection, a retry, a bank
// holiday, and GoCardless is the one that knows it. Only the schedules still
// collecting are asked about, usually one.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { teamMember, patientId } = await requirePatientAccess(event, typeof query.patientId === 'string' ? query.patientId : undefined)
  setHeader(event, 'Cache-Control', 'no-store')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: schedules } = await admin
    .from('payment_schedules')
    .select('id, gocardless_subscription_id')
    .eq('account_id', teamMember.account_id)
    .eq('patient_id', patientId)
    .eq('provider', 'gocardless')
    .in('status', ['active', 'past_due'])
  const next: Record<string, string | null> = {}
  if (!schedules?.length) return { next }

  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) return { next }

  await Promise.all(
    schedules.map(async (s) => {
      try {
        const { subscriptions: subscription } = await request<{ subscriptions: GcSubscription }>('GET', `/subscriptions/${encodeURIComponent(s.gocardless_subscription_id!)}`)
        next[s.id] = subscription.upcoming_payments?.[0]?.charge_date ?? null
      } catch (err) {
        // The line simply shows no date; nothing about collecting depends on it.
        console.error('[gocardless upcoming] not readable', s.gocardless_subscription_id, (err as Error).message)
        next[s.id] = null
      }
    }),
  )
  return { next }
})
