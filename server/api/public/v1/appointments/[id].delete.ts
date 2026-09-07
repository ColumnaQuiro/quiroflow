import { ApiError, defineApiHandler, notFound } from '~/server/utils/publicApi'
import { asRow, loose } from '~/server/utils/publicApiHandlers'
import { assertUuid } from '~/server/utils/publicApiQuery'
import { appointmentsResource } from '~/server/utils/publicApiResources'

// DELETE *cancels*: it sets status to 'cancelled' and leaves the row alone.
//
// It does not erase the appointment, and that's deliberate rather than a
// shortcut. A cancelled appointment is part of a clinic's record -- it feeds
// no-show and cancellation reporting, and it's what a practitioner looks at
// when a patient says "but I cancelled that". An API that let an external
// integration hard-delete history would be a way to lose it silently.
//
// Erasing an appointment entirely is still possible from the calendar in
// QuiroFlow, where a person is making that call knowingly.
export default defineApiHandler({ scope: 'appointments:write' }, async ({ event, supabase, accountId }) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id')

  const { data } = await loose(supabase)
    .from('appointments')
    .select(appointmentsResource.select)
    .eq('account_id', accountId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) throw notFound('appointment')
  const existing = asRow(data)

  // Idempotent: cancelling an already-cancelled appointment is a no-op that
  // still returns 200, so a retried webhook or a re-run job doesn't fail.
  // The row was fetched in full above precisely so this needs no second query.
  if (existing.status === 'cancelled') {
    return { data: appointmentsResource.serialize(existing) }
  }

  const { data: updated, error } = await loose(supabase)
    .from('appointments')
    .update({ status: 'cancelled' } as never)
    .eq('account_id', accountId)
    .eq('id', id)
    .select(appointmentsResource.select)
    .single()
  if (error) throw new ApiError('server_error', error.message)

  return { data: appointmentsResource.serialize(updated) }
})
