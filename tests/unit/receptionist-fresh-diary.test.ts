import { describe, expect, it } from 'vitest'
import { changesTheDiary, offersPastTimeToday } from '../../utils/receptionistAutoReply'
import { cleanReply, historyMarkersSection } from '../../utils/receptionistHistory'

// 22 Oct 2026: replies written from a diary that had moved on. A time offered
// at 15:25 was offered again at 18:30, after it had passed; and twice the team
// moved a visit while a reply was being written, which then told the patient
// the time they had just been given was taken.

// Thursday 22 Oct 2026, 18:30 in Madrid (16:30Z).
const at1830 = new Date('2026-10-22T16:30:00Z')

describe('A time today that has already gone by', () => {
  it('is caught when it is offered again', () => {
    expect(offersPastTimeToday('Para tu cita, ¿te viene bien hoy jueves a las 18:00 o prefieres el lunes 26 a las 15:00?', at1830, 'Europe/Madrid')).toBe(true)
    expect(offersPastTimeToday('Hoy tengo libres las 15:15 o las 19:00.', at1830, 'Europe/Madrid')).toBe(true)
  })

  it('leaves times later today alone', () => {
    expect(offersPastTimeToday('Hoy tengo libre a las 19:00 con Natacha.', at1830, 'Europe/Madrid')).toBe(false)
    expect(offersPastTimeToday('Te espero hoy jueves 22 de octubre a las 19:45.', at1830, 'Europe/Madrid')).toBe(false)
  })

  it('does not read another day as today', () => {
    expect(offersPastTimeToday('Hoy no me queda nada, pero el martes 27 a las 10:00 sí.', at1830, 'Europe/Madrid')).toBe(false)
    expect(offersPastTimeToday('Hoy ya no puedo. Mañana viernes no hay consulta; el lunes a las 15:00?', at1830, 'Europe/Madrid')).toBe(false)
    expect(offersPastTimeToday('Tengo el miércoles 28 a las 09:30.', at1830, 'Europe/Madrid')).toBe(false)
  })

  it("reads the clock in the clinic's zone", () => {
    // 18:30Z is 20:30 in Madrid: 19:00 has gone by there.
    expect(offersPastTimeToday('Hoy a las 19:00.', new Date('2026-10-22T18:30:00Z'), 'Europe/Madrid')).toBe(true)
  })
})

describe('A change in the diary while a reply is written', () => {
  it('counts a visit booked, moved, cancelled or had', () => {
    expect(changesTheDiary({ action: 'created', changes: null })).toBe(true)
    expect(changesTheDiary({ action: 'deleted', changes: null })).toBe(true)
    expect(changesTheDiary({ action: 'updated', changes: { starts_at: { from: 'a', to: 'b' }, ends_at: { from: 'a', to: 'b' } } })).toBe(true)
    expect(changesTheDiary({ action: 'updated', changes: { status: { from: 'booked', to: 'completed' } } })).toBe(true)
  })

  it('does not count bookkeeping the crons do to every visit', () => {
    expect(changesTheDiary({ action: 'updated', changes: { reminder_sent_at: { from: null, to: 'x' } } })).toBe(false)
    expect(changesTheDiary({ action: 'updated', changes: null })).toBe(false)
  })
})

describe('What it is told about the conversation', () => {
  it('trusts only the visits and free times it is given now', () => {
    const section = historyMarkersSection(true)
    expect(section).toContain('may no longer be true')
    expect(section).toContain('never offer a time again just because it was offered before')
  })

  it('takes the name off with the opener, whatever ends it', () => {
    expect(cleanReply('Perfecto, Lucía. ¿Te viene bien el jueves 29 a las 16:00?')).toBe('¿Te viene bien el jueves 29 a las 16:00?')
    expect(cleanReply('¡Perfecto, Ana! Te espero el jueves.')).toBe('Te espero el jueves.')
  })
})
