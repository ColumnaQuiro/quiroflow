import type { AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { ruleFiltersMatch } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'
import { offerExpiresAt as offerDeadline, waitlistEntryMatches } from '~/utils/waitlistOffer'

export { WAITLIST_OFFER_TTL_HOURS } from '~/utils/waitlistOffer'

interface SlotToOffer {
  accountId: string
  clinicId: string
  roomId: string | null
  practitionerId: string | null
  appointmentTypeId: string | null
  startsAt: string
  endsAt: string
  /**
   * A place in a group class (class_sessions): offered only to that class's
   * own waitlist, and "free" means a place is left rather than nobody being
   * booked at that time -- the other places fill the time by design.
   */
  classSessionId?: string | null
}

/**
 * Whether a group class still has a place: not cancelled, not yet started,
 * and fewer live places than it has. The claim asks again, and the database
 * once more when it books (appointments_class_place).
 */
export async function classHasPlace(supabase: any, sessionId: string): Promise<boolean> {
  const [{ data: session }, { count }] = await Promise.all([
    supabase.from('class_sessions').select('capacity, cancelled_at, starts_at').eq('id', sessionId).maybeSingle(),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('class_session_id', sessionId).neq('status', 'cancelled').is('deleted_at', null),
  ])
  if (!session || session.cancelled_at || new Date(session.starts_at).getTime() <= Date.now()) return false
  return (count ?? 0) < session.capacity
}

/**
 * Whether nothing now occupies this slot: no live appointment for its
 * practitioner or in its room, and no blocked time -- the practitioner's own,
 * at any clinic, or the whole clinic's. Cancelled and deleted appointments hold no time.
 *
 * A slot is offered when it is freed, but the offer then sits for up to two
 * hours, and staff book and block the calendar without any idea it exists.
 * So both ends ask again: the claim before it books (the database asks once
 * more under the booking lock, save_appointment_if_free), and the expiry
 * sweep before it hands the slot to the next person in line.
 */
export async function waitlistSlotIsFree(
  supabase: any,
  slot: { accountId: string; clinicId: string; roomId: string | null; practitionerId: string | null; startsAt: string; endsAt: string },
): Promise<boolean> {
  const busy = (column: 'practitioner_id' | 'room_id', id: string) =>
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', slot.accountId)
      .eq(column, id)
      .neq('status', 'cancelled')
      .is('deleted_at', null)
      .lt('starts_at', slot.endsAt)
      .gt('ends_at', slot.startsAt)
      .then(({ count }: { count: number | null }) => (count ?? 0) > 0)

  let blocks = supabase
    .from('availability_blocks')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', slot.accountId)
    .lt('starts_at', slot.endsAt)
    .gt('ends_at', slot.startsAt)
  // One naming nobody, which closes this clinic for everyone, or one naming
  // this practitioner at ANY clinic -- their own blocked time follows them --
  // as the booking page reads them.
  blocks = slot.practitionerId
    ? blocks.or(`and(clinic_id.eq.${slot.clinicId},practitioner_id.is.null),practitioner_id.eq.${slot.practitionerId}`)
    : blocks.eq('clinic_id', slot.clinicId).is('practitioner_id', null)

  const checks = await Promise.all([
    slot.practitionerId ? busy('practitioner_id', slot.practitionerId) : false,
    slot.roomId ? busy('room_id', slot.roomId) : false,
    blocks.then(({ count }: { count: number | null }) => (count ?? 0) > 0),
  ])
  return !checks.some(Boolean)
}

// Offers a freed slot to the waitlist. Shared by every way a slot frees up --
// offer-next.post.ts (staff cancel or move), the portal's cancellation, a
// cancellation by WhatsApp reply or the public API -- and by
// expire-cron.post.ts, which re-offers a slot whose one-by-one offer timed
// out unclaimed.
//
// How depends on the clinic (accounts.waitlist_offer_mode):
//   one_by_one   the oldest waiting entry that matches, with a deadline; the
//                sweep hands it to the next one if it goes unclaimed.
//   all_at_once  everyone who matches (up to MAX_OFFERED_TOGETHER), each with
//                their own link and the same deadline; the first to claim
//                books it ([token].post.ts refuses a slot already taken and
//                puts the others back to waiting).
//
// Returns how many people it was offered to -- 0 when nobody matched or the
// slot is no longer free. `service` is the service role, for a waitlist rule
// that waits or branches (its run outlives this request); a rule that only
// sends goes through the caller's own client as it always has. Defaults to
// `supabase` for a caller that already holds the service role.
export const MAX_OFFERED_TOGETHER = 25
export async function offerNextWaitlistEntry(supabase: any, origin: string, slot: SlotToOffer, service: any = supabase): Promise<number> {
  // Capped at 20 minutes before the slot (utils/waitlistOffer): a two-hour
  // window on a slot starting in 50 minutes could be claimed after it began.
  // A slot starting sooner than that is offered to nobody.
  const expiresAt = offerDeadline(new Date(), new Date(slot.startsAt))
  if (!expiresAt) return 0

  // A slot re-offered by the expiry sweep was freed hours ago and may well
  // have been booked or blocked since; offering it would send somebody a link
  // to a time that is not there. (Straight after a cancellation it is free,
  // and this costs one look.)
  if (slot.classSessionId ? !(await classHasPlace(supabase, slot.classSessionId)) : !(await waitlistSlotIsFree(supabase, slot))) return 0

  // A class's place goes to that class's queue; any other slot to the
  // entries that name no class.
  let entries = supabase
    .from('waitlist_entries')
    .select('id, patient_id, appointment_type_id, practitioner_id')
    .eq('account_id', slot.accountId)
    .eq('clinic_id', slot.clinicId)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
  entries = slot.classSessionId ? entries.eq('class_session_id', slot.classSessionId) : entries.is('class_session_id', null)
  const [{ data: account }, { data: candidates }] = await Promise.all([
    supabase.from('accounts').select('waitlist_offer_mode').eq('id', slot.accountId).maybeSingle(),
    entries,
  ])
  const toAll = account?.waitlist_offer_mode === 'all_at_once'

  // First-come-first-served: entries whose preference is either "any" (null)
  // or matches this exact slot's type/practitioner, oldest first. A class's
  // own queue already names its class.
  const matching = slot.classSessionId ? (candidates ?? []) : (candidates ?? []).filter((c: { appointment_type_id: string | null; practitioner_id: string | null }) => waitlistEntryMatches(c, slot))
  const chosen = toAll ? matching.slice(0, MAX_OFFERED_TOGETHER) : matching.slice(0, 1)
  if (chosen.length === 0) return 0

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, filters')
    .eq('account_id', slot.accountId)
    .eq('trigger_event', 'waitlist.slot_offered')
    .eq('enabled', true)
  const slotDatetime = new Date(slot.startsAt).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  })

  let offered = 0
  for (const match of chosen) {
    const claimToken = crypto.randomUUID()
    // .eq('status', 'waiting') here is the guard against a race with another
    // concurrent offer pass matching the same entry twice -- if it's no longer
    // 'waiting' this update touches zero rows and the offer is dropped rather
    // than double-sent.
    const { data: updated } = await supabase
      .from('waitlist_entries')
      .update({
        status: 'offered',
        claim_token: claimToken,
        offered_at: new Date().toISOString(),
        offer_expires_at: expiresAt.toISOString(),
        offered_room_id: slot.roomId,
        offered_practitioner_id: slot.practitionerId,
        offered_appointment_type_id: slot.appointmentTypeId,
        offered_starts_at: slot.startsAt,
        offered_ends_at: slot.endsAt,
        offered_to_all: toAll,
      })
      .eq('id', match.id)
      .eq('status', 'waiting')
      .select('id')
      .maybeSingle()
    if (!updated) continue
    offered++

    const { data: patient } = await supabase
      .from('patients')
      .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
      .eq('id', match.patient_id)
      .maybeSingle()
    if (!patient) continue // offered either way; just couldn't load who to notify

    const claimLink = `${origin}/waitlist/${claimToken}`
    for (const rule of rules ?? []) {
      if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters))) continue
      await dispatchPatientRule(supabase, service, slot.accountId, rule.id, patient, origin, undefined, undefined, {
        waitlistClaimLink: claimLink,
        waitlistSlotDatetime: slotDatetime,
      })
    }
  }
  return offered
}

/**
 * Once one of several people offered the same slot together has booked it,
 * the others go back to waiting -- they did not turn it down, someone was
 * quicker -- and their links stop working (the token goes).
 */
export async function releaseOffersForSlot(
  supabase: any,
  slot: { accountId: string; clinicId: string; practitionerId: string | null; startsAt: string },
  exceptId: string,
): Promise<void> {
  let q = supabase
    .from('waitlist_entries')
    .update({
      status: 'waiting',
      claim_token: null,
      offered_at: null,
      offer_expires_at: null,
      offered_room_id: null,
      offered_practitioner_id: null,
      offered_appointment_type_id: null,
      offered_starts_at: null,
      offered_ends_at: null,
      offered_to_all: false,
    })
    .eq('account_id', slot.accountId)
    .eq('clinic_id', slot.clinicId)
    .eq('status', 'offered')
    .eq('offered_to_all', true)
    .eq('offered_starts_at', slot.startsAt)
    .neq('id', exceptId)
  q = slot.practitionerId ? q.eq('offered_practitioner_id', slot.practitionerId) : q.is('offered_practitioner_id', null)
  await q
}

/**
 * A cancellation nobody at the desk made -- the patient answering a WhatsApp
 * reminder "cancelar", or an integration through the public API -- offers the
 * slot only when the clinic asked for that (accounts.waitlist_auto_offer).
 * There is nobody to ask, so the clinic's setting answers for them. Never
 * throws: the cancellation has happened either way.
 */
export async function offerCancelledSlotIfAutomatic(service: any, origin: string, appointmentId: string): Promise<number> {
  try {
    const { data: appt } = await service
      .from('appointments')
      .select('account_id, clinic_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, class_session_id, accounts(waitlist_auto_offer)')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appt || appt.status !== 'cancelled' || !appt.accounts?.waitlist_auto_offer) return 0
    return await offerNextWaitlistEntry(service, origin, {
      accountId: appt.account_id,
      clinicId: appt.clinic_id,
      roomId: appt.room_id,
      practitionerId: appt.practitioner_id,
      appointmentTypeId: appt.appointment_type_id,
      startsAt: appt.starts_at,
      endsAt: appt.ends_at,
      classSessionId: appt.class_session_id,
    })
  } catch (e) {
    console.error('[waitlist] automatic offer failed', e)
    return 0
  }
}
