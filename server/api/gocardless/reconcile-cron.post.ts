import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The second net under the GoCardless webhook. GoCardless retries a failed
// delivery up to 8 times, but a deploy that is down for the whole window, or
// a bug that 500s every attempt, would still lose events -- and a lost
// payments/confirmed is collected money that no report shows. Once a day this
// lists each connected clinic's events of the last three days and runs them
// through the same handler the webhook uses. Everything there is idempotent,
// so events the webhook already handled change nothing -- and since
// gocardless_processed_events, they are skipped without asking GoCardless.
//
// It also re-reads each clinic's verification status, which GoCardless
// changes on its side as the clinic finishes onboarding there, so the
// Settings card is current even for a clinic that never opens it.
//
// Called by a pg_cron job (scheduled by hand in production, like every
// *-cron endpoint: CLAUDE.md, "Scheduling a cron is a manual step too").
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  if (!runtimeConfig.cronSecret || getHeader(event, 'x-cron-secret') !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin
  const { data: accounts } = await supabase.from('accounts').select('id').not('gocardless_organisation_id', 'is', null)
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()

  const summary: { accountId: string; events: number; failed: number; error?: string }[] = []
  for (const account of accounts ?? []) {
    const request = await gocardlessForAccount(supabase, account.id)
    if (!request) continue
    try {
      const creditor = await readGoCardlessCreditor(request)
      if (creditor?.verification_status) {
        await supabase.from('accounts').update({ gocardless_verification_status: creditor.verification_status }).eq('id', account.id)
      }
    } catch (err) {
      // The event listing below hears about a revoked token too; anything
      // else here only leaves yesterday's status on the card.
      if (!(err instanceof GoCardlessError && err.tokenGone)) console.error('[gocardless reconcile] verification not refreshed', account.id, (err as Error).message)
    }

    let events: GcEvent[] = []
    try {
      events = (
        await Promise.all(
          ['payments', 'mandates', 'subscriptions', 'billing_requests', 'refunds'].map((resource) =>
            gocardlessListAll<GcEvent>(request, '/events', 'events', { resource_type: resource, 'created_at[gt]': since }),
          ),
        )
      ).flat()
    } catch (err) {
      if (err instanceof GoCardlessError && err.tokenGone) await forgetGoCardlessConnection(supabase, account.id)
      summary.push({ accountId: account.id, events: 0, failed: 0, error: (err as Error).message })
      continue
    }
    // Oldest first, so a payment's confirmation is booked before its
    // chargeback is looked at.
    events.sort((a, b) => a.created_at.localeCompare(b.created_at))
    let failed = 0
    for (const gcEvent of events) {
      try {
        await handleGoCardlessEvent(supabase, account.id, gcEvent, origin)
      } catch (err) {
        failed++
        console.error('[gocardless reconcile] event failed', account.id, gcEvent.id, (err as Error).message)
      }
    }
    summary.push({ accountId: account.id, events: events.length, failed })
  }
  // What is older than GoCardless's retry window (about a week) and this
  // cron's three-day replay can never arrive again.
  await supabase.from('gocardless_processed_events').delete().lt('processed_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())

  return { accounts: summary }
})
