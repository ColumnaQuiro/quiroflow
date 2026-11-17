import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Asks GoCardless about this patient's open sign-up links. The Money tab
// calls it when it opens on a patient with a link out: the patient has often
// just signed at the desk, and the billing_requests/fulfilled webhook may not
// have arrived yet (or, on a laptop, cannot arrive at all). Whatever the
// webhook would have done is done here, by the same function.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId?: string }>(event)
  const { teamMember, patientId } = await requirePatientAccess(event, body?.patientId)

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: open } = await admin
    .from('gocardless_billing_requests')
    .select('gocardless_billing_request_id')
    .eq('account_id', teamMember.account_id)
    .eq('patient_id', patientId)
    .eq('status', 'pending')
  if (!open?.length) return { changed: false }

  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) return { changed: false }

  let changed = false
  for (const row of open) {
    try {
      const result = await syncGoCardlessBillingRequest(admin, request, teamMember.account_id, row.gocardless_billing_request_id)
      if (result && result.status !== 'pending') changed = true
    } catch (err) {
      if (err instanceof GoCardlessError && err.tokenGone) {
        await forgetGoCardlessConnection(admin, teamMember.account_id)
        return { changed: false }
      }
      // A read that fails here is retried by the webhook and the reconcile
      // cron; the Money tab just shows the link as still out.
      console.error('[gocardless link sync]', row.gocardless_billing_request_id, (err as Error).message)
    }
  }
  return { changed }
})
