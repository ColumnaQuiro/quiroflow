// What create_patient_booking and reschedule_patient_appointment refuse with,
// in the patient's language. The RPCs raise plain English sentences with no
// error code (20260930141539, 20260930160011), and /book printed them as they
// came. Matched on the start of the sentence, so a reworded reason the app
// does not know yet still reaches the patient, in English, rather than
// nothing at all.
const REASONS: [prefix: string, en: string, es: string][] = [
  ['That time is no longer available', 'That time is no longer available. Please choose another.', 'Esa hora ya no está disponible. Elige otra.'],
  ['That time is not available for booking', 'That time is not available. Please choose another.', 'Esa hora no está disponible. Elige otra.'],
  ['Cannot book a time in the past', 'That time has already passed. Please choose another.', 'Esa hora ya ha pasado. Elige otra.'],
  ['That date is too far in advance', 'That date is too far ahead to book from the app.', 'Esa fecha está demasiado lejos para reservarla desde la app.'],
  ['Please choose a time further ahead', 'Please choose a time further ahead, or contact the clinic.', 'Elige una hora más adelante o contacta con la clínica.'],
  ['Too close to the appointment', 'It is too close to the appointment to change it here — please contact the clinic.', 'Queda muy poco para la cita para cambiarla desde aquí: contacta con la clínica.'],
  ['This appointment can no longer be changed', 'This appointment can no longer be changed.', 'Esta cita ya no se puede cambiar.'],
  ['Booking from the app is not enabled', 'Booking from the app is not enabled for this clinic.', 'Esta clínica no tiene activadas las reservas desde la app.'],
  ['Rescheduling from the app is not enabled', 'Changing appointments from the app is not enabled for this clinic.', 'Esta clínica no permite cambiar citas desde la app.'],
  ['This appointment type is only available to new patients', 'This appointment type is only for new patients.', 'Este tipo de cita es solo para pacientes nuevos.'],
  ['This appointment type is only available to existing patients', 'This appointment type is only for existing patients.', 'Este tipo de cita es solo para pacientes de la clínica.'],
  ['This appointment type has to be paid online', "This appointment type is paid online when booked, which the app can't do yet. Book it on the clinic's booking page or contact the clinic.", 'Este tipo de cita se paga online al reservar, y la app todavía no puede hacerlo. Resérvala en la página de reservas de la clínica o contacta con ella.'],
  ['Practitioner not available', 'That practitioner is not available for this.', 'Ese profesional no está disponible para esto.'],
  ['Appointment type not available', 'That appointment type is not available.', 'Ese tipo de cita no está disponible.'],
  ['Clinic not available for online booking', 'Online booking is not available for this clinic.', 'Esta clínica no tiene disponible la reserva online.'],
]

export function bookingErrorMessage(message: string | null | undefined, t: (en: string, es: string) => string): string {
  const text = message ?? ''
  const known = REASONS.find(([prefix]) => text.startsWith(prefix))
  if (known) return t(known[1], known[2])
  return text || t('Something went wrong. Please try again.', 'Algo ha ido mal. Inténtalo de nuevo.')
}
