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
}

/**
 * Whether nothing now occupies this slot: no live appointment for its
 * practitioner or in its room, and no blocked time -- the practitioner's own
 * or the whole clinic's. Cancelled and deleted appointments hold no time.
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
    .eq('clinic_id', slot.clinicId)
    .lt('starts_at', slot.endsAt)
    .gt('ends_at', slot.startsAt)
  // One naming this practitioner, or one naming nobody, which closes the
  // clinic for everyone -- as the booking page reads them.
  blocks = slot.practitionerId ? blocks.or(`practitioner_id.is.null,practitioner_id.eq.${slot.practitionerId}`) : blocks.is('practitioner_id', null)

  const checks = await Promise.all([
    slot.practitionerId ? busy('practitioner_id', slot.practitionerId) : false,
    slot.roomId ? busy('room_id', slot.roomId) : false,
    blocks.then(({ count }: { count: number | null }) => (count ?? 0) > 0),
  ])
  return !checks.some(Boolean)
}

// Shared by offer-next.post.ts (fires right after a staff cancellation) and
// expire-cron.post.ts (re-offers a slot whose previous offer timed out
// unclaimed) -- both ultimately do the same thing: find the oldest waiting
// entry that matches this freed slot, mark it offered, and notify them.
// Returns true if an offer went out, false if no waiting entry matched.
// `service` is the service role, for a waitlist rule that waits or branches
// (its run outlives this request); a rule that only sends goes through the
// caller's own client as it always has. Defaults to `supabase` for a caller
// that already holds the service role.
export async function offerNextWaitlistEntry(supabase: any, origin: string, slot: SlotToOffer, service: any = supabase): Promise<boolean> {
  // Capped at 20 minutes before the slot (utils/waitlistOffer): a two-hour
  // window on a slot starting in 50 minutes could be claimed after it began.
  // A slot starting sooner than that is offered to nobody.
  const expiresAt = offerDeadline(new Date(), new Date(slot.startsAt))
  if (!expiresAt) return false

  // A slot re-offered by the expiry sweep was freed hours ago and may well
  // have been booked or blocked since; offering it would send somebody a link
  // to a time that is not there. (Straight after a cancellation it is free,
  // and this costs one look.)
  if (!(await waitlistSlotIsFree(supabase, slot))) return false

  const { data: candidates } = await supabase
    .from('waitlist_entries')
    .select('id, patient_id, appointment_type_id, practitioner_id')
    .eq('account_id', slot.accountId)
    .eq('clinic_id', slot.clinicId)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })

  // First-come-first-served: oldest entry whose preference is either "any"
  // (null) or matches this exact slot's type/practitioner.
  const match = (candidates ?? []).find((c: { appointment_type_id: string | null; practitioner_id: string | null }) => waitlistEntryMatches(c, slot))
  if (!match) return false

  const claimToken = crypto.randomUUID()
  const offerExpiresAt = expiresAt.toISOString()

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
      offer_expires_at: offerExpiresAt,
      offered_room_id: slot.roomId,
      offered_practitioner_id: slot.practitionerId,
      offered_appointment_type_id: slot.appointmentTypeId,
      offered_starts_at: slot.startsAt,
      offered_ends_at: slot.endsAt,
    })
    .eq('id', match.id)
    .eq('status', 'waiting')
    .select('id')
    .maybeSingle()
  if (!updated) return false

  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
    .eq('id', match.patient_id)
    .maybeSingle()
  if (!patient) return true // slot is offered either way; just couldn't load who to notify

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, filters')
    .eq('account_id', slot.accountId)
    .eq('trigger_event', 'waitlist.slot_offered')
    .eq('enabled', true)

  const claimLink = `${origin}/waitlist/${claimToken}`
  const slotDatetime = new Date(slot.startsAt).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  })

  for (const rule of rules ?? []) {
    if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters))) continue
    await dispatchPatientRule(supabase, service, slot.accountId, rule.id, patient, origin, undefined, undefined, {
      waitlistClaimLink: claimLink,
      waitlistSlotDatetime: slotDatetime,
    })
  }

  return true
}
