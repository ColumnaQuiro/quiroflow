import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'

// What the desk's "Mark as arrived" sets off, for a patient who checked
// themselves in -- from the app or portal ("Ya estoy aquí") or the front-desk
// tablet (the check-in portal): the practitioner's "Ha llegado" push and the
// clinic's appointment.checked_in automations. On the service role, after the
// arrival is recorded, and never failing it: each step is logged and skipped.
// Only for a FIRST arrival; a second tap tells nobody again.
export async function afterPatientArrival(service: SupabaseClient<Database>, appointmentId: string, origin: string, logTag: string) {
  const { data: appt } = await service.from('appointments').select('id, account_id, patient_id').eq('id', appointmentId).maybeSingle()
  if (!appt?.patient_id) return
  const after = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(`[${logTag}] ${what} failed for ${appt.id}`, err)
    }
  }
  await after('staff push', () => pushAppointmentEvent(service, appt.id, 'checked_in'))
  await after('automations', async () => {
    const { data: patient } = await service
      .from('patients')
      .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
      .eq('id', appt.patient_id!)
      .maybeSingle()
    if (!patient) return
    const { data: rules } = await service
      .from('automation_rules')
      .select('id, filters')
      .eq('account_id', appt.account_id)
      .eq('trigger_event', 'appointment.checked_in')
      .eq('enabled', true)
    for (const rule of rules ?? []) {
      if (!(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters, appt.id))) continue
      await dispatchPatientRule(service, service, appt.account_id, rule.id, patient, origin, appt.id, {
        triggerEvent: 'appointment.checked_in',
        patientId: patient.id,
        appointmentId: appt.id,
      })
    }
  })
}
