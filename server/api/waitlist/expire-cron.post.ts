import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { offerNextWaitlistEntry } from '~/server/utils/waitlistOffer'

// Sweeps offered waitlist entries whose offer window has passed, marks them
// expired, and re-offers the same freed slot to the next matching waiting
// entry -- same secret-header cron pattern as the automations crons
// (hours-before-cron.post.ts etc). Meant to run every 15-30 minutes; an
// offer sitting unclaimed a little past its exact expiry isn't harmful, it
// just delays the next person's chance at the slot slightly.
const SEND_CONCURRENCY = 5

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: expiring } = await supabase
    .from('waitlist_entries')
    .select('id, account_id, clinic_id, offered_room_id, offered_practitioner_id, offered_appointment_type_id, offered_starts_at, offered_ends_at')
    .eq('status', 'offered')
    .lt('offer_expires_at', new Date().toISOString())
  if (!expiring || expiring.length === 0) return { expired: 0, reoffered: 0 }

  const origin = getRequestURL(event).origin

  let reoffered = 0
  await mapWithConcurrency(expiring, SEND_CONCURRENCY, async (entry) => {
    // .eq('status', 'offered') guards against a claim landing between the
    // select above and this update -- if so, leave it as 'booked', don't
    // stomp it back to 'expired'.
    const { data: updated } = await supabase
      .from('waitlist_entries')
      .update({ status: 'expired' })
      .eq('id', entry.id)
      .eq('status', 'offered')
      .select('id')
      .maybeSingle()
    if (!updated || !entry.offered_starts_at || !entry.offered_ends_at) return

    const reofferedThis = await offerNextWaitlistEntry(supabase, origin, {
      accountId: entry.account_id,
      clinicId: entry.clinic_id,
      roomId: entry.offered_room_id,
      practitionerId: entry.offered_practitioner_id,
      appointmentTypeId: entry.offered_appointment_type_id,
      startsAt: entry.offered_starts_at,
      endsAt: entry.offered_ends_at,
    })
    if (reofferedThis) reoffered++
  })

  return { expired: expiring.length, reoffered }
})
