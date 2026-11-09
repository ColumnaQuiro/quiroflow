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

  it('cancels from typed text only when the whole message is a cancellation', () => {
    expect(appointmentReplyIntent('Cancelar la cita, por favor')).toBe('cancelled')
    expect(appointmentReplyIntent('Cancelo mi cita gracias')).toBe('cancelled')
    expect(appointmentReplyIntent('Annuler mon rendez-vous merci')).toBe('cancelled')
    // Names a visit, which need not be the one the last reminder was about:
    // the Tuesday one was cancelled for this.
    expect(appointmentReplyIntent('Cancelar la del viernes, la del martes la mantengo')).toBeNull()
    expect(appointmentReplyIntent('Cancelar la de mañana')).toBeNull()
  })

  it('reads a button by its title, as the template wrote it', () => {
    expect(appointmentReplyIntent('Cancelar cita', { button: true })).toBe('cancelled')
    expect(appointmentReplyIntent('Confirmar asistencia', { button: true })).toBe('confirmed')
  })

  it('does not take a conditional or a doubt for a yes', () => {
    expect(appointmentReplyIntent('Si no puedo ir, ¿qué hago?')).toBeNull()
    expect(appointmentReplyIntent('Si puedo ir os aviso')).toBeNull()
    expect(appointmentReplyIntent('Sí, pero ¿la puedo cambiar?')).toBe('reschedule_requested')
    expect(appointmentReplyIntent('Vale, aunque igual llego tarde')).toBeNull()
  })

  it('still takes a plain yes, accent or not', () => {
    expect(appointmentReplyIntent('Si')).toBe('confirmed')
    expect(appointmentReplyIntent('Si, gracias')).toBe('confirmed')
    expect(appointmentReplyIntent('si gracias')).toBe('confirmed')
    expect(appointmentReplyIntent('Sí allí estaré')).toBe('confirmed')
    expect(appointmentReplyIntent('Confirmo, gracias')).toBe('confirmed')
  })
})
