import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { enrolAppointmentMoments } from '~/server/utils/automationAtomRules'
import { applyDueExerciseSchedules, sendExerciseReminders } from '~/server/utils/exerciseReminders'
import { sendOwnerWeeklyDigests } from '~/server/utils/weeklyDigest'
import { deliverDueGiftVouchers } from '~/server/utils/giftVouchers'
import { sendOpenDayReminders } from '~/server/utils/timeClock'
import { pushChangedWalletPasses } from '~/server/utils/walletPush'
import { syncChangedGoogleWalletPasses } from '~/server/utils/googleWallet'
import { closeNewPublicHolidays } from '~/server/utils/publicHolidays'

// Fires the automations timed from an appointment's start at a time of day
// (the morning of it, the evening before...), for accounts with one -- same reasoning/auth
// pattern as birthday-cron.post.ts: "is this appointment today" has no
// client action to hang off of. Scheduled every 15 minutes; each rule acts
// from its own time of day for twenty minutes, in EACH CLINIC's zone
// (clinics.timezone), over that clinic's own day.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const now = new Date()

  const supabase = serverSupabaseServiceRole<Database>(event)

  // The team's 8:00 "your day" push rides on this cron rather than one of its
  // own: it already runs every 15 minutes and reads each clinic's clock, and a
  // new endpoint would be one more pg_cron job to create by hand in
  // production (CLAUDE.md, "Scheduling a cron"). Before the rule lookup, so a
  // clinic with no same-day automation still gets it.
  await sendStaffMorningSummaries(supabase, now)
  // Patients' daily exercise reminder rides here for the same reason.
  await sendExerciseReminders(supabase, now)
  // And the exercises a patient's schedule gives at the visit they just reached.
  await applyDueExerciseSchedules(supabase)
  // And the owners' Monday summary of last week (server/utils/weeklyDigest.ts).
  await sendOwnerWeeklyDigests(supabase, getRequestURL(event).origin, now)
  // And gift vouchers bought to arrive on a given day, from 09:00 Madrid on it
  // (server/utils/giftVouchers.ts); those with no day go out from the webhook.
  await deliverDueGiftVouchers(supabase, getRequestURL(event).origin, now)
  // And the 20:00 "your working day is still open" push (server/utils/timeClock.ts).
  await sendOpenDayReminders(supabase, now)
  // And Apple Wallet: bonos whose sessions or next visit changed are pushed
  // to the phones holding them, which then fetch the new pass (server/utils/walletPush.ts).
  await pushChangedWalletPasses(supabase, now)
  // Google Wallet keeps the pass on its side: those are sent again instead
  // (server/utils/googleWallet.ts).
  await syncChangedGoogleWalletPasses(supabase, getRequestURL(event).origin, now)
  // And the official holidays of a year a deploy has just brought, for clinics
  // that close on them automatically (server/utils/publicHolidays.ts). A no-op
  // every other run: their marker is already at the end of what is known.
  await closeNewPublicHolidays(supabase, now)

  // The automations timed from an appointment's start at a time of day --
  // "the day of the appointment, at 9:00" (what appointment.same_day was),
  // "the day before, at 18:00" -- in each clinic's own zone
  // (server/utils/automationAtomRules.ts).
  return { sent: await enrolAppointmentMoments(supabase, getRequestURL(event).origin, 'start_day', now) }
})
