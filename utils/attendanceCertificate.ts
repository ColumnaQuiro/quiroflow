// The wording of a justificante de asistencia: the paper a patient hands
// their employer, school or court to show they were at the clinic. Spanish
// clinics are asked for one most days, and the only way to make it was to
// type it out in a word processor.
//
// It says who, where, when and who saw them, and nothing clinical: not the
// appointment type, not the reason. An employer is owed proof of attendance,
// not a diagnosis.
//
// Kept apart from the PDF (server/utils/attendanceCertificatePdf.ts) so the
// wording is unit-tested without pdfkit.

export type CertificateLanguage = 'es' | 'en'

export interface AttendanceCertificateInput {
  patientName: string
  nationalId: string | null
  clinicName: string
  startsAt: string
  endsAt: string
  timeZone: string
  practitionerName: string | null
  issuedAt: Date
  language: CertificateLanguage
}

export interface AttendanceCertificateText {
  title: string
  body: string
  closing: string
  practitionerLine: string | null
  signatureLabel: string
}

export function certificateLanguage(preferred: string | null | undefined): CertificateLanguage {
  return preferred === 'en' ? 'en' : 'es'
}

export function attendanceCertificateText(input: AttendanceCertificateInput): AttendanceCertificateText {
  const locale = input.language === 'en' ? 'en-GB' : 'es-ES'
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: input.timeZone }).format(new Date(input.startsAt))
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: input.timeZone })
  const from = time.format(new Date(input.startsAt))
  const to = time.format(new Date(input.endsAt))
  const issued = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: input.timeZone }).format(input.issuedAt)
  const id = input.nationalId?.trim()

  if (input.language === 'en') {
    return {
      title: 'Certificate of attendance',
      body: `This is to certify that ${input.patientName}${id ? `, with ID ${id},` : ''} attended an appointment at ${input.clinicName} on ${day}, from ${from} to ${to}.`,
      closing: `Issued at the request of the patient on ${issued}.`,
      practitionerLine: input.practitionerName ? `Practitioner: ${input.practitionerName}` : null,
      signatureLabel: 'Signature and stamp',
    }
  }
  return {
    title: 'Justificante de asistencia',
    body: `Se hace constar que ${input.patientName}${id ? `, con DNI/NIE ${id},` : ''} ha asistido a consulta en ${input.clinicName} el ${day}, de ${from} a ${to} h.`,
    closing: `Y para que conste a los efectos oportunos, se expide el presente justificante a petición de la persona interesada el ${issued}.`,
    practitionerLine: input.practitionerName ? `Profesional: ${input.practitionerName}` : null,
    signatureLabel: 'Firma y sello',
  }
}

/**
 * Whether the visit happened, which is the only thing a justificante may
 * claim. Completed, or any step of the day's flow recorded (checked in, with
 * the practitioner, at checkout) -- the same moments utils/appointmentStage
 * calls "arrived", so the button and the server never disagree. Never a
 * cancelled or missed visit, nor a booking that hasn't come round yet.
 */
export function visitWasAttended(appt: {
  status: string
  checked_in_at: string | null
  flow_with_practitioner_at?: string | null
  flow_checkout_at?: string | null
  deleted_at: string | null
}): boolean {
  if (appt.deleted_at) return false
  if (appt.status === 'cancelled' || appt.status === 'no_show') return false
  return appt.status === 'completed' || !!appt.checked_in_at || !!appt.flow_with_practitioner_at || !!appt.flow_checkout_at
}
