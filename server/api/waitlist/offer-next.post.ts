import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { offerNextWaitlistEntry } from '~/server/utils/waitlistOffer'

// Offers a slot staff just freed to the waitlist, fire-and-forget beside the
// action that freed it -- a failed offer shouldn't block or undo it:
//
//   { appointmentId }             a cancellation (CancelStep, the app's
//                                 CancelVisitSheet), when "offer it" is ticked
//   { appointmentId, movedFrom }  a visit moved to another time: the time it
//                                 left. Only when the clinic offers freed
//                                 slots automatically (accounts.
//                                 waitlist_auto_offer) -- a move never asks.
interface Body { appointmentId: string; movedFrom?: string }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireTeamMember(event)

  const { data: appt } = await supabase
    .from('appointments')
    .select('account_id, clinic_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status')
    .eq('id', body.appointmentId)
    .maybeSingle()
  if (!appt) return { offered: false, count: 0 }

  // The offer itself runs on the service role, as the expiry sweep's does.
  // The slot goes to the oldest matching entry on the clinic's waitlist and
  // is checked free against every booking in the room -- neither of which is
  // the same as what the person who cancelled may read: a practitioner who
  // sees only their own patients and calendar cannot read other patients'
  // waitlist rows (or, before, read them but not the patient to notify), nor
  // a colleague's booking in the same room. Reading the appointment above
  // through their own client is what establishes they may free this slot.
  const service = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin

  let slot: { startsAt: string; endsAt: string }
  if (body.movedFrom) {
    // A move: the time it left, as the move itself recorded it -- a
    // reschedule logged in the last quarter of an hour, so a stale or made-up
    // time is never offered -- at the visit's own length.
    const { data: account } = await service.from('accounts').select('waitlist_auto_offer').eq('id', appt.account_id).maybeSingle()
    if (!account?.waitlist_auto_offer) return { offered: false, count: 0 }
    const { data: moved } = await supabase
      .from('appointment_reschedules')
      .select('from_starts_at')
      .eq('appointment_id', body.appointmentId)
      .eq('from_starts_at', body.movedFrom)
      .gte('created_at', new Date(Date.now() - 15 * 60000).toISOString())
      .limit(1)
      .maybeSingle()
    if (!moved || appt.status === 'cancelled') return { offered: false, count: 0 }
    const length = Date.parse(appt.ends_at) - Date.parse(appt.starts_at)
    slot = { startsAt: moved.from_starts_at, endsAt: new Date(Date.parse(moved.from_starts_at) + length).toISOString() }
  } else {
    // Only a genuinely cancelled appointment frees a slot worth offering --
    // this endpoint being called at all implies that already happened, but a
    // stale/racing call shouldn't offer a slot that's actually still booked.
    if (appt.status !== 'cancelled') return { offered: false, count: 0 }
    slot = { startsAt: appt.starts_at, endsAt: appt.ends_at }
  }

  const offered = await offerNextWaitlistEntry(service, origin, {
    accountId: appt.account_id,
    clinicId: appt.clinic_id,
    roomId: appt.room_id,
    practitionerId: appt.practitioner_id,
    appointmentTypeId: appt.appointment_type_id,
    ...slot,
  })

  return { offered: offered > 0, count: offered }
})
