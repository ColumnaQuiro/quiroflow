import { describe, expect, it } from 'vitest'
import { AUTOMATED_MARK, COLLEAGUE_MARK, cleanReply, historyLine, historyMarkersSection, INFORMAL_ADDRESS_LINE, LATER_ANSWER_LINE, offeredTimeCount, SENT_FILES_LINE, STATED_LIMITS_LINE } from '../../utils/receptionistHistory'
import { rescheduleSection } from '../../utils/receptionistTypes'

// The reminder in the history read as one of the receptionist's own replies,
// and a voice note or a photo had no text, so it was dropped.
describe('The conversation as the receptionist reads it', () => {
  it('marks what the automations sent, not what it or a person wrote', () => {
    expect(historyLine({ direction: 'outbound', body: 'Hola *Ana* 👋, te recordamos tu cita', automated: true })).toBe(`${AUTOMATED_MARK}\nHola *Ana* 👋, te recordamos tu cita`)
    expect(historyLine({ direction: 'outbound', body: 'Te espero el martes', automated: false })).toBe('Te espero el martes')
  })

  it('says what they sent when it is not text', () => {
    expect(historyLine({ direction: 'inbound', body: null, mediaType: 'audio' })).toContain('[Voice note')
    expect(historyLine({ direction: 'inbound', body: 'Me aparece esto', mediaType: 'image' })).toBe('[Image]\nMe aparece esto')
    expect(historyLine({ direction: 'inbound', body: null, mediaType: 'document', mediaFilename: 'informe.pdf' })).toContain('informe.pdf')
    expect(historyLine({ direction: 'inbound', body: null })).toBe('')
  })
})

// Told "at most 2 per reply", it offered one person five.
describe('Counting the times a reply offers', () => {
  it('counts different clock times', () => {
    expect(offeredTimeCount('El martes 20 a las 10:00 o a las 12:00, y el jueves a las 9.30, 11:00 y 17h30.')).toBe(5)
    expect(offeredTimeCount('Te la confirmo el jueves 22 a las 19:30.')).toBe(1)
  })

  it('does not count opening hours', () => {
    expect(offeredTimeCount('Abrimos de 9:00 a 13:00 y de 15:00-20:00. Tengo libre el martes a las 10:00.')).toBe(1)
    expect(offeredTimeCount('Atendemos entre las 9:00 y las 13:00.')).toBe(0)
  })
})

describe('Moving a visit next to another', () => {
  it('asks it to look at their other visits first', () => {
    const section = rescheduleSection([{ startsAt: '2026-10-21T15:30:00Z', typeName: 'Ajuste', practitionerName: null }] as never, 'Europe/Madrid', { listVisits: true, canBook: true })
    expect(section).toContain('Look at their other booked visits first')
  })
})

// It "corrected" a time a colleague had agreed, and opened with "Perfecto,
// Sonia" on its second day despite the rule.
describe('Day two', () => {
  it('marks what a colleague wrote, and not its own replies', () => {
    expect(historyLine({ direction: 'outbound', body: 'Te veo el miércoles a las 19:00', sentByAi: false })).toBe(`${COLLEAGUE_MARK}\nTe veo el miércoles a las 19:00`)
    expect(historyLine({ direction: 'outbound', body: 'Te veo el miércoles a las 19:00', sentByAi: true })).toBe('Te veo el miércoles a las 19:00')
  })

  it('takes off a forbidden opener and any mark it copied', () => {
    expect(cleanReply('Perfecto, Sonia: te he movido la cita al jueves.')).toBe('Te he movido la cita al jueves.')
    expect(cleanReply('¡Perfecto! Tu cita queda el jueves.')).toBe('Tu cita queda el jueves.')
    expect(cleanReply(`${COLLEAGUE_MARK}\nTe espero el jueves.`)).toBe('Te espero el jueves.')
    expect(cleanReply('Perfectamente puedes venir el jueves.')).toBe('Perfectamente puedes venir el jueves.')
    expect(cleanReply('NO_REPLY')).toBe('NO_REPLY')
  })
})

// Day four: "¡Claro! ¿Qué día te vendría mejor?" to a patient moving a visit,
// and a fresh draft for a conversation a person had already settled, because
// the reminder before "Confirmar" kept no text and dropped out of the history.
describe('Day four', () => {
  it('takes off "¡Claro!" and "Por supuesto" too', () => {
    expect(cleanReply('¡Claro! ¿Qué día y hora te vendría mejor?')).toBe('¿Qué día y hora te vendría mejor?')
    expect(cleanReply('Claro que sí, te la muevo al jueves.')).toBe('Te la muevo al jueves.')
    expect(cleanReply('Por supuesto. Tengo libre el martes.')).toBe('Tengo libre el martes.')
    expect(cleanReply('Claramente es mejor por la tarde.')).toBe('Claramente es mejor por la tarde.')
  })

  it('keeps a template send that stored no text, so "Confirmar" reads as an answer to it', () => {
    const line = historyLine({ direction: 'outbound', body: null, automated: true, templateName: 'appointment_reminder' })
    expect(line.startsWith(AUTOMATED_MARK)).toBe(true)
    expect(line).toContain('appointment_reminder')
    expect(historyLine({ direction: 'outbound', body: null, automated: false })).toBe('')
  })
})

// 23-24 Oct: "Más adelante" on a recall answered with free times or "no hay
// ningún mensaje previo mío", a ten-day-old document answered with "te
// añado", usted given back to a lead who wrote in usted, a visit moved to a
// day the patient had said she could not come, and a patient unsure of their
// visit's date handed over with the diary already answering it.
describe('Days twelve and thirteen', () => {
  it('answers "Más adelante" without offering times', () => {
    expect(LATER_ANSWER_LINE).toContain('"Más adelante"')
    expect(LATER_ANSWER_LINE).toContain('Do not offer times')
  })

  it('treats an answer to an automatic message as an answer to the clinic', () => {
    expect(historyMarkersSection(false)).toContain('never say there is no earlier message')
  })

  it('speaks only of documents sent since the last reply, and never adds them itself', () => {
    expect(SENT_FILES_LINE).toContain("after the clinic's last reply")
    expect(SENT_FILES_LINE).toContain('mi compañera lo añadirá a tu ficha')
  })

  it('keeps tú when they write in usted', () => {
    expect(INFORMAL_ADDRESS_LINE).toContain('even when they write to you as usted')
  })

  it('checks what they said earlier before booking a time', () => {
    expect(STATED_LIMITS_LINE).toContain('ask whether it really suits them')
  })

  it('tells them when a visit is before anything else', () => {
    const section = rescheduleSection([{ startsAt: '2026-10-22T17:45:00Z', typeName: 'Ajuste' }] as never, 'Europe/Madrid', { listVisits: true, canBook: true })
    expect(section).toContain('If they are unsure when one of these is')
  })
})
