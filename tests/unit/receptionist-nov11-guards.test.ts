import { describe, expect, it } from 'vitest'
import { colleaguePromise, colleaguePromiseReason, HANDED_OVER_REPLY, VOICE_NOTE_REPLY } from '../../utils/receptionistFollowThrough'
import { misstatedVisitNote, misstatedVisitTime, unbookedClaim, unbookedClaimNote } from '../../utils/receptionistHistory'

// The checks in code added after the daily review of 11 Nov 2026: each case
// below is what was sent that day, reworded without the people in it.

const none = new Set<string>()

describe('colleaguePromise', () => {
  it('catches a promise that a colleague will do something', () => {
    expect(colleaguePromise('Gracias. En cuanto a la prueba, mi compañera la añadirá a tu ficha para que Jordana la revise en la consulta.')).toContain('mi compañera la añadirá')
    expect(colleaguePromise('Lo reviso con el equipo. Mi compañera te confirmará la hora mañana.')).toContain('te confirmará')
    expect(colleaguePromise('Entendido, se lo paso a mi compañera para gestionarlo y te escribe en breve.')).toBeTruthy()
    expect(colleaguePromise('Mi compañera te va a llamar esta tarde.')).toBeTruthy()
    expect(colleaguePromise('My colleague will check it and get back to you.')).toBeTruthy()
    expect(colleaguePromise('Je transmets à ma collègue.')).toBeTruthy()
  })

  it('leaves alone a reply that promises nothing of a colleague', () => {
    expect(colleaguePromise('Te queda reservado el martes 17 de noviembre a las 15:30 con Natacha.')).toBeNull()
    expect(colleaguePromise('Tu visita del miércoles 18 de noviembre a las 16:00 con Jordana se mantiene tal cual.')).toBeNull()
    expect(colleaguePromise('¿Qué día te vendría bien?')).toBeNull()
  })

  it('names what was promised in the handover note', () => {
    expect(colleaguePromiseReason('Mi compañera te confirmará la hora.')).toContain('Mi compañera te confirmará la hora.')
  })

  it('counts the fixed replies as promises, which they are', () => {
    expect(colleaguePromise(VOICE_NOTE_REPLY)).toBeTruthy()
    expect(colleaguePromise(HANDED_OVER_REPLY)).toBeTruthy()
  })
})

describe('misstatedVisitTime', () => {
  const theirs = new Set(['18:15'])

  it('refuses the time they insist on when the diary has another', () => {
    const reply = 'Tienes razón, disculpa la confusión: la cita del otro quedó a las 18:00h y la tuya a las 18:30h, ambas con Natacha el jueves 12 de noviembre.'
    expect(misstatedVisitTime(reply, none, theirs)).toContain('18:30')
  })

  it('lets the diary\'s own time through, and a time a tool just set', () => {
    expect(misstatedVisitTime('Según tengo en el sistema, tu cita del jueves 12 de noviembre es a las 18:15h con Natacha.', none, theirs)).toBeNull()
    expect(misstatedVisitTime('Te esperamos el martes 17 a las 15:30.', new Set(['15:30']), theirs)).toBeNull()
  })

  it('does not treat an offer of other times as their visit', () => {
    expect(misstatedVisitTime('Para tu cita tengo libre el martes 17 a las 19:30 o el miércoles 18 a las 17:45.', none, theirs)).toBeNull()
    expect(misstatedVisitTime('¿Quieres que tu cita pase a las 19:30?', none, theirs)).toBeNull()
  })

  it('says nothing for someone with no visit in the diary', () => {
    expect(misstatedVisitTime('Tu cita es a las 10:00.', none, none)).toBeNull()
  })

  it('tells the model the diary\'s time and to hand over if they are sure', () => {
    const note = misstatedVisitNote('la tuya a las 18:30h', theirs)
    expect(note).toContain('18:15')
    expect(note).toContain('hand_over_to_colleague')
  })
})

describe('unbookedClaim, nothing to cancel', () => {
  it('catches "no la dejo reservada" when nothing was cancelled', () => {
    expect(unbookedClaim('No te preocupes, no la dejo reservada entonces. Escríbenos cuando quieras otra fecha y te la busco.', none, none)).toContain('no la dejo reservada')
    expect(unbookedClaim('Vale, te la quito.', none, none)).toBeTruthy()
  })

  it('reads a time written "18:30h"', () => {
    expect(unbookedClaim('Tu cita queda a las 18:30h.', none, new Set(['18:15']))).toContain('18:30h')
  })

  it('leaves the question "¿te la quito?" alone', () => {
    expect(unbookedClaim('¿Te la quito?', none, none)).toBeNull()
  })

  it('tells the model they have nothing booked when the diary is empty', () => {
    expect(unbookedClaimNote('no la dejo reservada', { noVisits: true })).toContain('no upcoming visit')
    expect(unbookedClaimNote('no la dejo reservada')).not.toContain('no upcoming visit')
  })
})
