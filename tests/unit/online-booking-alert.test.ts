import { describe, it, expect } from 'vitest'
import { onlineBookingAlert } from '../../utils/onlineBookingAlert'

const booking = {
  patientFirstName: 'Edwin',
  patientLastName: 'Coloma',
  patientPhone: '34611732681',
  practitionerName: 'Raúl Catalán',
  appointmentTypeName: 'Primera visita',
  // 10:00 in Madrid (CEST, UTC+2).
  startsAt: '2026-10-14T08:00:00Z',
  timeZone: 'Europe/Madrid',
}

describe('onlineBookingAlert', () => {
  it('names the patient and the visit in the subject, so no two bookings thread together', () => {
    const subject = onlineBookingAlert(booking).subject
    expect(subject).to.match(/^Nueva reserva online: Edwin Coloma · 14 oct/)
    expect(subject).to.contain('10:00')
    expect(subject).to.not.equal(onlineBookingAlert({ ...booking, patientFirstName: 'Lucía', patientLastName: null }).subject)
    expect(subject).to.not.equal(onlineBookingAlert({ ...booking, startsAt: '2026-10-14T09:00:00Z' }).subject)
  })

  it("tells the time in the clinic's zone, not the server's", () => {
    expect(onlineBookingAlert({ ...booking, timeZone: 'Atlantic/Canary' }).subject).to.contain('09:00')
  })

  it('says who, how to reach them, with whom, when and what', () => {
    // The date's own wording ("a las") is ICU's, so it is not pinned here.
    const summary = onlineBookingAlert(booking).summary
    expect(summary).to.match(/^Nueva reserva online: Edwin Coloma \(34611732681\) con Raúl Catalán el 14 de octubre de 2026\b.*10:00 \(Primera visita\)\.$/)
  })

  it('still reads when the booking is missing details', () => {
    const alert = onlineBookingAlert({ ...booking, patientFirstName: '', patientLastName: null, patientPhone: null, practitionerName: '', appointmentTypeName: '' })
    expect(alert.subject).to.match(/^Nueva reserva online: Sin nombre · /)
    expect(alert.summary).to.match(/^Nueva reserva online: Sin nombre con un profesional el .*\.$/)
  })

  it('escapes what the person booking typed in the email body', () => {
    const html = onlineBookingAlert({ ...booking, patientFirstName: '<a href="https://x.test">Pulse aquí</a>' }).html
    expect(html).to.not.contain('<a href')
    expect(html).to.contain('&lt;a href=&quot;https://x.test&quot;&gt;')
  })
})
