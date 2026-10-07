import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { offerNextWaitlistEntry } from '~/server/utils/waitlistOffer'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'

// A patient cancelling their own visit, from the app or the web portal.
//
// It used to be a bare cancel_patient_appointment RPC from the browser, and
// so it told nobody: no push to the practitioner ("changes" -- which a
// patient's WhatsApp cancellation does send), no appointment.cancelled
// automation, and no offer of the freed slot to the waitlist, all of which a
// staff cancellation and a WhatsApp one do. The slot just sat empty.
//
// The cancellation itself is still the RPC, run as the patient: ownership,
// the notice window and the status are all checked there, exactly as
// before. Only once it has succeeded does the rest run, on the service role
// (as webhook.post.ts and offer-next.post.ts do) -- and a failure in any of
// it never undoes or fails the cancellation the patient asked for.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId?: string }>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireAuthedUser(event)
  // The RPC accepts a visit that is already cancelled, so without this a
  // repeated call (a double tap, a retry) would tell everyone again.
  const { data: before } = await supabase.from('appointments').select('status').eq('id', body.appointmentId).maybeSingle()
  if (before?.status === 'cancelled') return { cancelled: true, offered: false }
  const { error } = await supabase.rpc('cancel_patient_appointment', { p_appointment_id: body.appointmentId })
  if (error) throw createError({ statusCode: 400, statusMessage: error.message })

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: appt } = await service
    .from('appointments')
    .select('id, account_id, clinic_id, room_id, practitioner_id, appointment_type_id, patient_id, starts_at, ends_at, status')
    .eq('id', body.appointmentId)
    .maybeSingle()
  if (!appt || appt.status !== 'cancelled') return { cancelled: true }

  const origin = getRequestURL(event).origin
  const after = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(`[patient-cancel] ${what} failed for ${appt.id}`, err)
    }
  }

  await after('staff push', () => pushAppointmentEvent(service, appt.id, 'cancelled'))
  await after('automations', async () => {
    const { data: patient } = await service
      .from('patients')
      .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
      .eq('id', appt.patient_id)
      .maybeSingle()
    if (!patient) return
    const { data: rules } = await service
      .from('automation_rules')
      .select('id, filters')
      .eq('account_id', appt.account_id)
      .eq('trigger_event', 'appointment.cancelled')
      .eq('enabled', true)
    for (const rule of rules ?? []) {
      if (!(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters, appt.id))) continue
      await dispatchPatientRule(service, service, appt.account_id, rule.id, patient, origin, appt.id, {
        triggerEvent: 'appointment.cancelled',
        patientId: patient.id,
        appointmentId: appt.id,
      })
    }
  })
  let offered = false
  await after('waitlist offer', async () => {
    offered = await offerNextWaitlistEntry(service, origin, {
      accountId: appt.account_id,
      clinicId: appt.clinic_id,
      roomId: appt.room_id,
      practitionerId: appt.practitioner_id,
      appointmentTypeId: appt.appointment_type_id,
      startsAt: appt.starts_at,
      endsAt: appt.ends_at,
    })
  })
  return { cancelled: true, offered }
})
