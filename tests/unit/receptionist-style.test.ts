import { describe, it, expect } from 'vitest'
import { FIXED_IN_CODE, fixStyle, styleNote, styleProblems } from '../../utils/receptionistStyle'
import { teamCallNames, teamSection } from '../../utils/receptionistClinic'
import { isNoReplyMessage, replyActed } from '../../utils/receptionistAutoReply'
import { offeredTypesSection, typesForAudience, type PromptType } from '../../utils/receptionistTypes'

// What the first three weeks of the receptionist's replies got wrong over and
// over, each time with a line in the prompt that already forbade it -- now
// checked in code (utils/receptionistStyle.ts and friends).

const team = ['Marta Soler', 'Lucía Pons']

describe('House style, checked after the model writes', () => {
  it('passes a reply that keeps to it', () => {
    expect(styleProblems('Tu cita queda movida al miércoles 11 de noviembre a las 18:00 con Marta.', team)).toEqual([])
  })

  it('finds each thing the prompt forbids', () => {
    expect(styleProblems('Te esperamos 😊', team)).toEqual(['emoji'])
    expect(styleProblems('¡Perfecto! Te espero el martes.', team)).toEqual(['opener'])
    expect(styleProblems('¡Hola, María! Te espero el martes.', team)).toEqual(['opener'])
    expect(styleProblems('Se lo paso a un compañero.', team)).toEqual(['colleague'])
    expect(styleProblems('Tu cita es el 20/10 a las 10:00.', team)).toEqual(['numeric_date'])
    expect(styleProblems('Como vienes del anuncio, tienes la oferta.', team)).toEqual(['ad'])
    expect(styleProblems('Tengo hueco a las 11:30 con Marta Soler.', team)).toEqual(['surname'])
  })

  it('does not take a time or a price for a date', () => {
    expect(styleProblems('A las 18:00 o a las 18:15, son 50,00 €.', team)).toEqual([])
  })

  it('mends emojis, openers and surnames by itself, and sends the rest back for rewording', () => {
    expect(FIXED_IN_CODE).toEqual(['emoji', 'opener', 'surname'])
    expect(fixStyle('¡Perfecto! tu cita queda con Marta Soler 🙏', team)).toBe('Tu cita queda con Marta')
    expect(fixStyle('¡Hola, Ana! Te espero el martes.', team)).toBe('Hola, Ana. Te espero el martes.')
    expect(fixStyle('Claro, te la cambio.', team)).toBe('Te la cambio.')
    expect(styleNote(['colleague', 'numeric_date'])).toContain('"mi compañera" or "mi compañero"')
    expect(styleNote(['ad'])).toContain('never speak of an ad')
  })
})

describe('The team, by name', () => {
  it('calls everyone by first name, unless two share one', () => {
    expect([...teamCallNames(['Marta Soler', 'Lucía Pons']).values()]).toEqual(['Marta', 'Lucía'])
    expect([...teamCallNames(['Ana Ruiz', 'Ana López', 'Óscar Gil']).values()]).toEqual(['Ana Ruiz', 'Ana López', 'Óscar'])
  })

  // "¿Tenéis chico y chica?" went unanswered: the prompt named nobody (31 Oct 2026).
  it('lists who sees patients and leaves their gender to their names', () => {
    const section = teamSection(team)
    expect(section).toContain('The chiropractors who see patients: Marta, Lucía.')
    expect(section).toContain('Work out from each name whether that person is a woman or a man')
    expect(section).toContain('whether there is a man or a woman, answer from this list')
    expect(section).not.toContain('Soler')
    expect(teamSection([])).toBe('')
  })
})

describe('A thanks closes the exchange', () => {
  const phrases = ['Gracias', 'Confirmar']
  const confirmed = { body: 'Tu cita queda movida al miércoles 11 de noviembre a las 18:00.', automated: false }

  // Answered with the same confirmation again (31 Oct 2026).
  it('needs no answer however it is put', () => {
    expect(isNoReplyMessage(['Vale muchas gracias 🙏'], phrases, confirmed)).toBe(true)
    expect(isNoReplyMessage(['Vale', 'Mil gracias!'], phrases, confirmed)).toBe(true)
    expect(isNoReplyMessage(['Muy bien, gracias, hasta luego'], phrases, confirmed)).toBe(true)
  })

  it('is still a message when it says anything else, when it is only a vale, or after a question', () => {
    expect(isNoReplyMessage(['Gracias, ¿y el jueves?'], phrases, confirmed)).toBe(false)
    expect(isNoReplyMessage(['Vale'], phrases, confirmed)).toBe(false)
    expect(isNoReplyMessage(['Sí, gracias'], phrases, confirmed)).toBe(false)
    expect(isNoReplyMessage(['Vale gracias'], phrases, { body: '¿Te lo confirmo el martes a las 10:00?', automated: false })).toBe(false)
  })
})

describe('The first-visit offer, said as an offer', () => {
  const offer: PromptType = { name: 'Oferta Primera visita', durationMinutes: 60, stage: 'first_visit_offer', priceCents: 5000 }
  const first: PromptType = { name: 'Primera visita', durationMinutes: 60, stage: 'first_visit', priceCents: 7000 }

  // "La primera visita tiene un precio de 50 €" to a lead from the ad (31 Oct 2026).
  it('to someone from the ad, with what it normally costs', () => {
    const { types, adOnly, regular } = typesForAudience([first, offer], 'new_from_ad')
    expect(regular?.name).toBe('Primera visita')
    const section = offeredTypesSection(types, adOnly, { regularFirstVisit: regular })
    expect(section).toContain('"ahora mismo tenemos una oferta de primera visita por 50 €" (you may add that it normally costs 70 €)')
    expect(section).toContain('never as its plain price')
    expect(section).toContain('never as something they get because of an ad')
  })

  it('says nothing of it to someone who is offered the plain first visit', () => {
    const { types, adOnly } = typesForAudience([first, offer], 'new')
    expect(offeredTypesSection(types, adOnly)).not.toContain('never as its plain price')
  })
})

describe('A reply that did something', () => {
  it('is one a booking, cancellation or handover of a visit made', () => {
    expect(replyActed([{ name: 'find_free_times', ok: true }])).toBe(false)
    expect(replyActed([{ name: 'book_appointment', ok: false }])).toBe(false)
    expect(replyActed([{ name: 'cancel_appointment', ok: true }])).toBe(true)
  })
})
