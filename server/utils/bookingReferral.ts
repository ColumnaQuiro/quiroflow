import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'

type Service = ReturnType<typeof serverSupabaseServiceRole<Database>>

// A booking made through a patient's referral link (/book/<slug>?ref=<code>):
// the new patient is recorded as referred by them -- the same
// patients.referred_by_patient_id "Referred by" the record sets by hand -- and
// the clinic's patient.referred automations run for the referrer, as they do
// when staff set it.
//
// Only for someone genuinely new: no referrer yet, no attended visit before
// this booking, and not the referrer themselves. Only while the clinic has the
// programme on. Best-effort: the booking has already been made.
export async function applyBookingReferral(service: Service, accountId: string, appointmentId: string, code: string, origin: string): Promise<boolean> {
  const clean = code.trim().toUpperCase().slice(0, 16)
  if (!/^[A-Z0-9]{4,16}$/.test(clean)) return false
  const { data: account } = await service.from('accounts').select('referral_program_enabled').eq('id', accountId).maybeSingle()
  if (!account?.referral_program_enabled) return false
  const [{ data: referrer }, { data: appt }] = await Promise.all([
    service.from('patients').select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels').eq('account_id', accountId).eq('referral_code', clean).maybeSingle(),
    service.from('appointments').select('patient_id').eq('id', appointmentId).eq('account_id', accountId).maybeSingle(),
  ])
  const newPatientId = appt?.patient_id
  if (!referrer || !newPatientId || newPatientId === referrer.id) return false
  const { count: before } = await service.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', newPatientId).eq('status', 'completed').is('deleted_at', null)
  if ((before ?? 0) > 0) return false
  // Only where nobody is recorded yet: a referral set by hand is not replaced.
  const { data: set } = await service.from('patients').update({ referred_by_patient_id: referrer.id }).eq('id', newPatientId).is('referred_by_patient_id', null).select('id')
  if (!set?.length) return false

  try {
    const { data: rules } = await service.from('automation_rules').select('id, filters').eq('account_id', accountId).eq('trigger_event', 'patient.referred').eq('enabled', true)
    for (const rule of rules ?? []) {
      if (!(await ruleFiltersMatch(service, referrer.id, rule.filters as AutomationFilters))) continue
      await dispatchPatientRule(service, service, accountId, rule.id, referrer, origin, undefined, { triggerEvent: 'patient.referred', patientId: referrer.id })
    }
  } catch (err) {
    console.error('[booking-referral] automations failed', appointmentId, err)
  }
  return true
}
