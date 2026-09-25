// What a merge field in an automation resolves to: a WhatsApp template's
// {{n}} slot mapped to a source in the automation builder
// (components/campaigns/AutomationModal.vue), or a {{token}} in an automated
// email. Pure, so each value can be checked without sending anything.
//
// Appointment dates and times are written in the clinic's own time zone
// (clinics.timezone), and the clinic's name, phone and address are fields of
// their own, so a clinic's template can say how to reach that location.
export const DEFAULT_TIMEZONE = 'Europe/Madrid'

export interface MergeRecipient {
  firstName: string
  lastName: string | null
  email: string | null
}

export interface MergeContext {
  nextAppointmentAt?: string
  googleReviewUrl?: string
  waitlistClaimLink?: string
  waitlistSlotDatetime?: string
  clinicName?: string
  clinicPhone?: string
  clinicAddress?: string
  clinicTimezone?: string
}

export function automationFieldValue(recipient: MergeRecipient, source: string, context?: MergeContext): string {
  const timeZone = context?.clinicTimezone || DEFAULT_TIMEZONE
  if (source === 'first_name') return recipient.firstName ?? ''
  if (source === 'last_name') return recipient.lastName ?? ''
  if (source === 'email') return recipient.email ?? ''
  if (source === 'google_review_link') return context?.googleReviewUrl ?? ''
  if (source === 'waitlist_claim_link') return context?.waitlistClaimLink ?? ''
  if (source === 'waitlist_slot_datetime') return context?.waitlistSlotDatetime ?? ''
  if (source === 'clinic_name') return context?.clinicName ?? ''
  if (source === 'clinic_phone') return context?.clinicPhone ?? ''
  // One line: a template variable cannot hold a line break.
  if (source === 'clinic_address') return (context?.clinicAddress ?? '').replace(/\s*\n\s*/g, ', ')
  if (source === 'next_appointment') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone })
  }
  // Split date/time -- some WhatsApp templates (Meta's own approved
  // "appointment_reminder" among them) have separate {{n}} slots for the
  // date and the time rather than one combined string like next_appointment.
  if (source === 'appointment_date') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone })
  }
  if (source === 'appointment_time') {
    if (!context?.nextAppointmentAt) return ''
    return new Date(context.nextAppointmentAt).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone })
  }
  return ''
}
