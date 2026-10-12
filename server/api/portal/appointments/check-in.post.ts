import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'

// "Ya estoy aquí": a patient checking themselves in on arrival, from the app,
// the portal, or the desk's QR code (/portal/check-in).
//
// The arrival itself is check_in_my_appointment, run as the patient: their
// own visit, still booked, and only from 90 minutes before it until it ends.
// Then what the desk's "Mark as arrived" does: the practitioner's "Ha llegado"
// push and the clinic's appointment.checked_in automations -- on the service
// role, after the fact, and never failing the check-in they asked for. A
// second tap returns the first arrival and tells nobody again.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId?: string }>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: before } = await supabase.from('appointments').select('checked_in_at').eq('id', body.appointmentId).maybeSingle()
  const { data: at, error } = await supabase.rpc('check_in_my_appointment', { p_appointment_id: body.appointmentId })
  if (error) throw createError({ statusCode: 400, statusMessage: error.message })
  if (!at) throw createError({ statusCode: 409, statusMessage: 'This visit cannot be checked in to right now' })
  if (before?.checked_in_at) return { checkedInAt: at }

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: appt } = await service.from('appointments').select('id, account_id, patient_id').eq('id', body.appointmentId).maybeSingle()
  if (!appt?.patient_id) return { checkedInAt: at }
  const origin = getRequestURL(event).origin
  const after = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(`[patient-check-in] ${what} failed for ${appt.id}`, err)
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
  return { checkedInAt: at }
})
