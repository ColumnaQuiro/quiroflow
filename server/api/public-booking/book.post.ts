import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { patientCardLink } from '~/server/utils/patientCardLink'
import { GIFT_REFUSAL, giftLabel, giftVoucherFor, redeemGiftVoucher } from '~/server/utils/giftVouchers'
import { throttlePublic } from '~/server/utils/publicRateLimit'

// The public booking page's booking, made here rather than by the page calling
// create_public_booking itself, so the clinic's "new online booking" alert goes
// out before the patient is told the booking worked.
//
// It used to be sent by a second request the page fired afterwards
// (send-confirmation.post.ts) -- immediately before redirecting to the
// clinic's thank-you page, which cancels any request the browser has not
// finished sending. Six of Columnaquiro's sixteen online bookings between 21
// and 28 Sep 2026 alerted nobody, and nothing recorded that they hadn't.
//
// The patient's own confirmation stays where it was: it takes several seconds
// of WhatsApp round-trips, too long to hold the booking screen for, and the
// reminders cron catches up any that request misses.
//
// Netlify gives this function no way to keep working after it has answered,
// so the alert is awaited. Email and a WhatsApp text are well under a second.
type BookingArgs = Database['public']['Functions']['create_public_booking']['Args']

export default defineEventHandler(async (event) => {
  // Twenty bookings in ten minutes from one address is a script, not a family.
  await throttlePublic(event, { scope: 'book', limit: 20, windowSeconds: 600 })

  // gift_code is ours, not the function's: a gift voucher to redeem onto the
  // patient once the booking has made or found them (below).
  const { gift_code: giftCode, ...body } = (await readBody<BookingArgs & { gift_code?: string }>(event)) ?? ({} as BookingArgs)
  if (!body?.p_account_slug) {
    throw createError({ statusCode: 400, statusMessage: 'p_account_slug is required' })
  }

  // As whoever is at the page -- anonymous, as the page itself was. The
  // function is security definer and checks everything it is given.
  const caller = await serverSupabaseClient<Database>(event)
  const { data, error } = await caller.rpc('create_public_booking', body as BookingArgs)
  if (error) {
    // The function's own refusals are written for the patient ("Esa hora ya
    // no está disponible…"), and the page shows them as they are.
    throw createError({ statusCode: 400, message: error.message, data: { message: error.message } })
  }

  const result = data as unknown as { appointment_id: string }
  try {
    const service = serverSupabaseServiceRole<Database>(event)
    const { data: appt } = await service.from('appointments').select('account_id').eq('id', result.appointment_id).maybeSingle()
    if (appt && (await claimStaffAlert(service, result.appointment_id))) {
      await notifyStaffOfOnlineBooking(service, appt.account_id, result.appointment_id)
    }
  } catch (err) {
    // The booking has been made; nothing about the alert may undo that for
    // the patient. The cron cannot retry this one -- the claim is taken -- so
    // it is at least said in the function log.
    console.error('[public-booking] staff alert failed', result.appointment_id, err)
  }

  // The clinic asks for a card to hold online bookings: the patient goes from
  // here to Stripe's card page (server/utils/patientCardLink.ts). The booking
  // is made either way; a card not given only means there is none to charge.
  let cardUrl: string | null = null
  try {
    cardUrl = await cardLinkForBooking(event, result.appointment_id)
  } catch (err) {
    console.error('[public-booking] card link failed', result.appointment_id, err)
  }

  // "Tengo un bono regalo": checked on the page before booking
  // (gift-check.post.ts) and redeemed here onto whoever the booking is for.
  // The booking stands either way; a voucher that cannot be redeemed is said,
  // and stays as it was for the desk.
  let gift: { redeemed: boolean; label?: string; message?: string } | null = null
  if (giftCode?.trim()) {
    try {
      gift = await redeemGiftAtBooking(event, result.appointment_id, giftCode)
    } catch (err: any) {
      console.error('[public-booking] gift voucher redeem failed', result.appointment_id, err)
      gift = { redeemed: false, message: err?.statusMessage ?? 'No se ha podido canjear el bono regalo. Dalo en recepción.' }
    }
  }

  return { ...(data as Record<string, unknown>), card_url: cardUrl, gift }
})

async function redeemGiftAtBooking(event: Parameters<typeof serverSupabaseServiceRole>[0], appointmentId: string, code: string) {
  const service = serverSupabaseServiceRole<Database>(event)
  const { data: appt } = await service.from('appointments').select('account_id, patient_id').eq('id', appointmentId).maybeSingle()
  if (!appt?.patient_id) return { redeemed: false, message: 'No se ha podido canjear el bono regalo. Dalo en recepción.' }
  const check = await giftVoucherFor(service, appt.account_id, code)
  if (!check.ok) return { redeemed: false, message: GIFT_REFUSAL[check.reason] }
  await redeemGiftVoucher(service, check.voucher, appt.patient_id, null)
  return { redeemed: true, label: giftLabel(check.voucher) }
}

async function cardLinkForBooking(event: Parameters<typeof serverSupabaseServiceRole>[0], appointmentId: string): Promise<string | null> {
  const service = serverSupabaseServiceRole<Database>(event)
  const { data: appt } = await service.from('appointments').select('account_id, patient_id, patients(id, first_name, last_name, email)').eq('id', appointmentId).maybeSingle()
  const patient = (appt as unknown as { patients: { id: string; first_name: string; last_name: string | null; email: string | null } | null } | null)?.patients
  if (!appt || !patient) return null
  const { data: account } = await service.from('accounts').select('online_booking_card_on_file, stripe_connect_account_id, stripe_publishable_key').eq('id', appt.account_id).maybeSingle()
  if (!account?.online_booking_card_on_file || !account.stripe_publishable_key) return null
  const { stripe, options } = await stripeClientFor(event, appt.account_id, account)
  const origin = getRequestURL(event).origin
  return await patientCardLink(service, stripe, options, {
    accountId: appt.account_id,
    patient,
    successUrl: `${origin}/card-saved?status=success&booking=1`,
    cancelUrl: `${origin}/card-saved?status=cancelled&booking=1`,
  })
}
