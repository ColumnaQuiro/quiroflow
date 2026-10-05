// The clinic's "new online booking" alert: what it says, by email and by
// WhatsApp text.
//
// Every one of these emails used to have the subject "Nueva reserva online",
// word for word. Gmail threads mail by subject and sender, so each booking
// was appended to one long conversation instead of arriving as new mail --
// Resend showed all of them delivered and opened while the clinic said it had
// never had one, and its new-lead alert, which names the lead in the subject,
// arrived as separate mail every time. Who and when go in the subject now, so
// no two bookings share one.

export interface OnlineBookingAlertInput {
  patientFirstName: string
  patientLastName: string | null
  patientPhone: string | null
  practitionerName: string
  appointmentTypeName: string
  startsAt: string
  timeZone: string
}

export function onlineBookingAlert(input: OnlineBookingAlertInput): { subject: string; summary: string; html: string } {
  const patientName = [input.patientFirstName, input.patientLastName].filter(Boolean).join(' ').trim() || 'Sin nombre'
  const startsAt = new Date(input.startsAt)
  const when = startsAt.toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: input.timeZone })
  const whenShort = startsAt.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: input.timeZone })

  const summary = `Nueva reserva online: ${patientName}${input.patientPhone ? ` (${input.patientPhone})` : ''} con ${input.practitionerName || 'un profesional'} el ${when}${input.appointmentTypeName ? ` (${input.appointmentTypeName})` : ''}.`
  return {
    subject: `Nueva reserva online: ${patientName} · ${whenShort}`,
    summary,
    // Escaped: the name is whatever the person booking typed.
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#4A4A57;line-height:1.6;">${escapeHtml(summary)}</div>`,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
