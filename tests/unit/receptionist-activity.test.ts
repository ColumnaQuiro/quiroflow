import { describe, expect, it } from 'vitest'
import { handoverReason, receptionistEventKind } from '../../utils/receptionistActivity'

// The receptionist's Overview reads what it did back from the notes it leaves
// in conversations (receptionistBooking.ts, receptionistSend.ts). These pin
// the openings those notes are recognised by: a reworded note would not
// break anything visible, it would just stop being counted as a booking.

describe('receptionistEventKind', () => {
  it('recognises what each note records', () => {
    expect(receptionistEventKind('He reservado Primera visita el lunes 20 de octubre, 10:00 con Ana.')).toBe('booked')
    expect(receptionistEventKind('He movido su Ajuste del lunes 20 al martes 21, 11:00.')).toBe('moved')
    expect(receptionistEventKind('He cancelado su cita del lunes 20 de octubre.')).toBe('cancelled')
    expect(receptionistEventKind('He apuntado a la lista de espera para Ajuste: por las mañanas.')).toBe('waitlisted')
    expect(receptionistEventKind('He pasado esta conversación a una persona. Motivo: quiere cancelar.')).toBe('handover')
  })

  it('reads a note whatever its case or surrounding space', () => {
    expect(receptionistEventKind('  HE RESERVADO Ajuste el martes.')).toBe('booked')
  })

  it('counts anything else as a plain note rather than guessing', () => {
    expect(receptionistEventKind('Reservada la primera visita.')).toBe('note')
    expect(receptionistEventKind('')).toBe('note')
  })
})

describe('handoverReason', () => {
  it('keeps only the reason of a handover note', () => {
    expect(handoverReason('He pasado esta conversación a una persona. Motivo: Menciona dolor torácico.')).toBe('Menciona dolor torácico.')
  })

  it('returns the whole note when it has no reason line', () => {
    expect(handoverReason('He pasado esta conversación a una persona.')).toBe('He pasado esta conversación a una persona.')
  })
})
