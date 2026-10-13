import { describe, expect, it } from 'vitest'
import { AUTOMATED_MARK, historyLine, offeredTimeCount } from '../../utils/receptionistHistory'
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
