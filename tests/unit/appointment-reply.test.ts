import { describe, expect, it } from 'vitest'
import { appointmentReplyIntent } from '../../utils/appointmentReply'

// What a reply to an appointment confirmation or reminder means (the
// WhatsApp webhook applies it to the appointment).

describe('an appointment reply', () => {
  it('reads the templates\' own buttons, in every language they are written in', () => {
    expect(appointmentReplyIntent('Confirmar')).toBe('confirmed')
    expect(appointmentReplyIntent('Cambiar cita')).toBe('reschedule_requested')
    expect(appointmentReplyIntent('Confirm')).toBe('confirmed')
    expect(appointmentReplyIntent('Reschedule')).toBe('reschedule_requested')
    // A French tap used to match nothing.
    expect(appointmentReplyIntent('Confirmer')).toBe('confirmed')
    expect(appointmentReplyIntent('Modifier')).toBe('reschedule_requested')
  })

  it('reads French typed by hand', () => {
    expect(appointmentReplyIntent('Oui merci')).toBe('confirmed')
    expect(appointmentReplyIntent('Je dois changer le rendez-vous')).toBe('reschedule_requested')
    expect(appointmentReplyIntent('Annuler')).toBe('cancelled')
  })

  it('does not read a change of contact details as a change of appointment', () => {
    expect(appointmentReplyIntent('Me gustaría cambiar el Mail que tenéis registrado')).toBeNull()
    expect(appointmentReplyIntent("Je voudrais changer mon adresse e-mail")).toBeNull()
    expect(appointmentReplyIntent('Pouvez-vous modifier mon numéro ?')).toBeNull()
  })

  it('still reads the Spanish it always has', () => {
    expect(appointmentReplyIntent('Sí')).toBe('confirmed')
    expect(appointmentReplyIntent('La tengo que cambiar')).toBe('reschedule_requested')
    expect(appointmentReplyIntent('Cancelar')).toBe('cancelled')
    expect(appointmentReplyIntent('Gracias')).toBeNull()
  })
})
