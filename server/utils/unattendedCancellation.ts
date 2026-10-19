import { pushAppointmentEvent } from '~/server/utils/staffPush'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'
import { offerCancelledSlotIfAutomatic } from '~/server/utils/waitlistOffer'

/**
 * What follows a cancellation nobody at the desk made -- the patient tapping
 * "Cancelar" on a WhatsApp reminder, or the receptionist cancelling a visit
 * they said they will not come to: the practitioner told, the clinic's
 * appointment.cancelled automations run, and the slot offered to the
 * waitlist when the clinic offers them automatically. No cancellation fee:
 * that stays a person's call, made from the calendar.
 *
 * Each step is best-effort and never throws -- the visit is cancelled either
 * way, and one failing must not stop the others.
 */
export async function afterUnattendedCancellation(service: any, origin: string, accountId: string, appointmentId: string, patientId: string): Promise<void> {
  const step = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(`[cancellation] ${what} failed for ${appointmentId}:`, (err as Error)?.message ?? err)
    }
  }
  await step('staff push', () => pushAppointmentEvent(service, appointmentId, 'cancelled'))
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
  await offerCancelledSlotIfAutomatic(service, origin, appointmentId)
}
