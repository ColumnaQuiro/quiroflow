import type { AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { ruleFiltersMatch } from '~/server/utils/evaluateAutomationFilters'
import { runRuleActions } from '~/server/utils/runAutomationActions'

// How long a waitlisted patient has to claim an offered slot before it's
// released back to the pool (expire-cron.post.ts) and re-offered to the
// next match. Short enough that a freed slot doesn't sit unusable for long,
// long enough that someone can see a WhatsApp message and respond.
export const WAITLIST_OFFER_TTL_HOURS = 2

interface SlotToOffer {
  accountId: string
  clinicId: string
  roomId: string | null
  practitionerId: string | null
  appointmentTypeId: string | null
  startsAt: string
  endsAt: string
}

// Shared by offer-next.post.ts (fires right after a staff cancellation) and
// expire-cron.post.ts (re-offers a slot whose previous offer timed out
// unclaimed) -- both ultimately do the same thing: find the oldest waiting
// entry that matches this freed slot, mark it offered, and notify them.
// Returns true if an offer went out, false if no waiting entry matched.
export async function offerNextWaitlistEntry(supabase: any, origin: string, slot: SlotToOffer): Promise<boolean> {
  const { data: candidates } = await supabase
    .from('waitlist_entries')
    .select('id, patient_id, appointment_type_id, practitioner_id')
    .eq('account_id', slot.accountId)
    .eq('clinic_id', slot.clinicId)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })

  // First-come-first-served: oldest entry whose preference is either "any"
  // (null) or matches this exact slot's type/practitioner.
  const match = (candidates ?? []).find(
    (c: { appointment_type_id: string | null; practitioner_id: string | null }) =>
      (!c.appointment_type_id || c.appointment_type_id === slot.appointmentTypeId) &&
      (!c.practitioner_id || c.practitioner_id === slot.practitionerId),
  )
  if (!match) return false

  const claimToken = crypto.randomUUID()
  const offerExpiresAt = new Date(Date.now() + WAITLIST_OFFER_TTL_HOURS * 60 * 60 * 1000).toISOString()

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
    await runRuleActions(supabase, slot.accountId, rule.id, patient, origin, undefined, undefined, {
      waitlistClaimLink: claimLink,
      waitlistSlotDatetime: slotDatetime,
    })
  }

  return true
}
