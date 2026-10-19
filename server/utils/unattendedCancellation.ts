import { automationEvent, dispatchPatientRule } from '~/server/utils/automationEngine'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { offerCancelledSlotIfAutomatic } from '~/server/utils/waitlistOffer'
import { pushAppointmentEvent } from '~/server/utils/staffPush'

/**
 * What follows a cancellation nobody at the desk made -- the patient tapping
 * "Cancelar" on a WhatsApp reminder (server/api/whatsapp/webhook.post.ts),
 * or the AI receptionist cancelling a visit they said they will not come to
 * (receptionistBooking.ts): the practitioner told, automation runs in
 * flight told, the clinic's appointment.cancelled rules run, and the freed
 * time offered to the waiting list when the clinic offers them
 * automatically. The same steps the in-app cancel takes through
 * /api/automations/fire, which has a staff session and this does not.
 *
 * No cancellation fee, ever: that stays a person's call, made from the
 * calendar (components/calendar/CancelStep.vue).
 *
 * Each step is best-effort and none throws: the visit is cancelled by the
 * time this runs, and a push that fails must not keep the automations from
 * running, or the slot from reaching the waiting list.
 */
export async function afterUnattendedCancellation(service: any, origin: string, accountId: string, appointmentId: string, patientId: string): Promise<void> {
  const step = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(`[cancellation] ${what} failed for appointment ${appointmentId}:`, (err as Error)?.message ?? err)
    }
  }
  await step('staff push', () => pushAppointmentEvent(service, appointmentId, 'cancelled'))
  await step('runs in flight', () => automationEvent(service, accountId, { patientId }, 'appointment.cancelled', origin))
  await step('automations', async () => {
    const { data: patient } = await service
      .from('patients')
      .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
      .eq('id', patientId)
      .maybeSingle()
    if (!patient) return
    const { data: rules } = await service
      .from('automation_rules')
      .select('id, filters')
      .eq('account_id', accountId)
      .eq('trigger_event', 'appointment.cancelled')
      .eq('enabled', true)
    for (const rule of rules ?? []) {
      if (!(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters, appointmentId))) continue
      await dispatchPatientRule(service, service, accountId, rule.id, patient, origin, appointmentId, {
        triggerEvent: 'appointment.cancelled',
        patientId: patient.id,
        appointmentId,
      })
    }
  })
  await step('waiting list', () => offerCancelledSlotIfAutomatic(service, origin, appointmentId))
}
