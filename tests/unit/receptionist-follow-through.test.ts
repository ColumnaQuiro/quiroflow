import { describe, expect, it } from 'vitest'
import { asksToChangeVisit, asksWhetherToCancel, cancelQuestionDue, offersTimes, chosenOfferedTime, chosenTimeNote, isVoiceNote, offeredTimes, sendFailedReason, VOICE_NOTE_REPLY } from '../../utils/receptionistFollowThrough'
import { BASE_BEHAVIOUR, BASE_ESCALATIONS } from '../../utils/receptionistBaseRules'
import { CONFIRM_BEFORE_BOOKING, phoneSharersSection } from '../../utils/receptionistTypes'

// What the receptionist decides in code rather than leaving to the prompt
// (utils/receptionistFollowThrough.ts), from the daily review of 2-6 Nov 2026.

describe('offeredTimes', () => {
  it('reads each time with the day said before it', () => {
    expect(offeredTimes('Tengo el martes 10 de noviembre a las 9:00 o el jueves 12 de noviembre a las 15:30, ambas con Jordana. ¿Cuál te viene mejor?')).toEqual([
      { weekday: 'martes', dayOfMonth: 10, relative: null, time: '9:00' },
      { weekday: 'jueves', dayOfMonth: 12, relative: null, time: '15:30' },
    ])
  })

  it('keeps two times on one day, and leaves "por la mañana" alone', () => {
    expect(offeredTimes('Hoy tengo libre a las 18:15 o a las 19:45 con Natacha. ¿Te confirmo alguna?').map((o) => [o.relative, o.time])).toEqual([['hoy', '18:15'], ['hoy', '19:45']])
    expect(offeredTimes('El martes 17 por la mañana: 13:15 o 13:30').every((o) => o.weekday === 'martes' && o.relative === null)).toBe(true)
  })

  it('does not read opening hours as times offered', () => {
    expect(offeredTimes('Abrimos de 9:00 a 20:00. ¿Te va el lunes 9 a las 10:00?')).toEqual([{ weekday: 'lunes', dayOfMonth: 9, relative: null, time: '10:00' }])
  })
})

describe('chosenOfferedTime', () => {
  const offer = 'El lunes 9 de noviembre la consulta está cerrada. ¿Te viene bien el martes 10 a las 9:00 o el jueves 12 a las 15:30?'

  // 5 Nov 2026: "Perdón si el 12" was asked "¿Te confirmo…?" and never booked.
  it('finds the one time a day number means', () => {
    expect(chosenOfferedTime(offer, 'Perdón si el 12')).toMatchObject({ weekday: 'jueves', dayOfMonth: 12, time: '15:30' })
  })

  it('finds it by weekday, by time, by hour or by "la primera"', () => {
    expect(chosenOfferedTime(offer, 'el jueves')?.time).toBe('15:30')
    expect(chosenOfferedTime(offer, '9:00')?.dayOfMonth).toBe(10)
    expect(chosenOfferedTime(offer, 'a las 9 me va bien')?.dayOfMonth).toBe(10)
    expect(chosenOfferedTime(offer, 'la primera')?.dayOfMonth).toBe(10)
    expect(chosenOfferedTime('Hoy tengo libre a las 18:15 o a las 19:45. ¿Te confirmo alguna?', '19:45')).toMatchObject({ relative: 'hoy', time: '19:45' })
  })

  it('chooses nothing when the answer could be more than one, or is not a choice', () => {
    expect(chosenOfferedTime('¿El jueves 12 a las 15:00 o a las 18:00?', 'el jueves')).toBeNull()
    expect(chosenOfferedTime(offer, '¿y el 12 por la tarde?')).toBeNull()
    expect(chosenOfferedTime(offer, 'el 12 no puedo')).toBeNull()
    expect(chosenOfferedTime(offer, 'el 14')).toBeNull()
    expect(chosenOfferedTime(offer, 'vale')).toBeNull()
    // A single time offered is answered by the prompt's own rule.
    expect(chosenOfferedTime('¿Te va el martes 10 a las 9:00?', 'el 10')).toBeNull()
  })

  it('tells the prompt to book it without asking again', () => {
    const note = chosenTimeNote(chosenOfferedTime(offer, 'el 12')!, true)
    expect(note).toContain('jueves 12 at 15:30')
    expect(note).toContain('do not ask them to confirm it again')
    expect(note).toContain('book_appointment')
  })
})

describe('asksWhetherToCancel and cancelQuestionDue', () => {
  it('recognises the question', () => {
    expect(asksWhetherToCancel('¿Te quito la cita del jueves 5 de noviembre a las 16:00 y me escribes cuando sepas qué día te viene?')).toBe(true)
    expect(asksWhetherToCancel('¿Prefieres cambiarla o la cancelamos?')).toBe(true)
    expect(asksWhetherToCancel('Te he quitado la cita del jueves.')).toBe(false)
    expect(asksWhetherToCancel('¿Te viene bien el martes a las 10:00?')).toBe(false)
  })

  // 4 Nov 2026: unanswered, a first visit stayed booked for a day she was not coming.
  it('hands over once the visit is within a day and an hour has passed', () => {
    const now = new Date('2026-11-04T18:00:00Z')
    expect(cancelQuestionDue({ askedAt: '2026-11-04T10:00:00Z', visitStartsAt: '2026-11-05T15:00:00Z', now })).toBe(true)
    expect(cancelQuestionDue({ askedAt: '2026-11-04T17:30:00Z', visitStartsAt: '2026-11-05T15:00:00Z', now })).toBe(false)
    expect(cancelQuestionDue({ askedAt: '2026-11-04T10:00:00Z', visitStartsAt: '2026-11-07T15:00:00Z', now })).toBe(false)
    expect(cancelQuestionDue({ askedAt: '2026-11-04T10:00:00Z', visitStartsAt: '2026-11-04T17:00:00Z', now })).toBe(false)
  })
})

describe('voice notes and refused sends', () => {
  it('answers a voice note with the fixed words the escalation rule gives', () => {
    expect(isVoiceNote('audio')).toBe(true)
    expect(isVoiceNote('image')).toBe(false)
    expect(BASE_ESCALATIONS.find((r) => r.rule.includes('voice note'))!.action).toContain(VOICE_NOTE_REPLY.replace(/\.$/, ''))
  })

  // 6 Nov 2026: refused for "do not contact", the reply sat as a draft nobody was told about.
  it('says why a reply did not go out', () => {
    expect(sendFailedReason(new Error('This patient cannot be contacted'))).toBe('No he podido enviar mi respuesta (This patient cannot be contacted). Te la he dejado como borrador: revísala y envíasela tú.')
    expect(sendFailedReason(null)).toBe('No he podido enviar mi respuesta. Te la he dejado como borrador: revísala y envíasela tú.')
  })
})

describe('rules from the review of 5 and 6 Nov', () => {
  const rules = BASE_BEHAVIOUR.join('\n')

  it('looks at the whole week asked for, and at the team when they are in a hurry', () => {
    expect(rules).toContain('look at every day of that week')
    expect(rules).toContain('el martes 10 tampoco me queda nada')
    expect(rules).toContain('any_chiropractor')
  })

  it('offers two times when they say yes to a recall', () => {
    expect(rules).toContain('¿te busco un hueco para la semana que viene?')
    expect(rules).toContain('offer two times in that week straight away')
  })

  it('does not book a visit they asked to cancel and cannot be found', () => {
    expect(rules).toContain('never treat that as a new booking')
  })

  it('takes a correction as the answer', () => {
    expect(CONFIRM_BEFORE_BOOKING).toContain('"perdón, sí, el 21"')
  })
})

describe('phoneSharersSection', () => {
  // 2 Nov 2026: a partner's visit on the same phone was called "not free".
  it('lists the visits of others on the same phone and lets them be named', () => {
    const s = phoneSharersSection([{ firstName: 'Pablo', lastName: 'Ruiz', upcoming: [{ startsAt: '2026-11-12T17:00:00Z', typeName: 'Ajuste', practitionerName: 'Natacha' }] }], 'Europe/Madrid', { sendsItself: true })
    expect(s).toContain('# Others on this same phone')
    expect(s).toContain('- Pablo Ruiz: next visits Thursday 12 November at 18:00 (Ajuste with Natacha)')
    expect(s).toContain('never say it is not free')
    expect(s).toContain('call hand_over_to_colleague')
  })

  it('is left out when nobody shares it', () => {
    expect(phoneSharersSection([], 'Europe/Madrid', { sendsItself: false })).toBe('')
  })
})

// The daily review of 7 Nov 2026, kept as cases so a fix that is already in
// does not quietly come back.
describe('7 Nov 2026 review', () => {
  // A recall answered "Sí, por favor", two times offered, "Lunes 16" chosen --
  // and then "¿Te confirmo el lunes 16…?" again before booking.
  it('reads "Lunes 16" as the one time chosen', () => {
    const offer = 'Te propongo lunes 16 a las 16:30 o martes 17 a las 09:30, ambos con Jordana. ¿Cuál prefieres?'
    expect(chosenOfferedTime(offer, 'Lunes 16')).toMatchObject({ weekday: 'lunes', dayOfMonth: 16, time: '16:30' })
  })

  // "Cambiar cita", then "la semana que viene no puedo": other times offered,
  // no answer, and the visit they could not come to stayed booked.
  it('knows a change request and a pending offer of times', () => {
    expect(asksToChangeVisit('Cambiar cita')).toBe(true)
    expect(asksToChangeVisit('La semana que viene no puedo 🫤')).toBe(true)
    expect(asksToChangeVisit('No podré ir el martes')).toBe(true)
    expect(asksToChangeVisit('Confirmar')).toBe(false)
    expect(asksToChangeVisit('Hay algun hueco lunes o miercoles por la tarde?')).toBe(false)
    expect(offersTimes('El lunes 16 no queda hueco libre. El miércoles 18 por la tarde tengo las 16:30 o las 17:45, ¿te viene bien alguna?')).toBe(true)
    expect(offersTimes('Listo: tu cita queda reservada para el lunes 16 de noviembre a las 16:30.')).toBe(false)
    expect(offersTimes('¿Qué día y franja te vendría mejor?')).toBe(false)
  })

  it('asks whether to cancel the visit meanwhile, in words the hand-over reads', () => {
    expect(BASE_BEHAVIOUR.some((line) => line.includes('cancel the one they have meanwhile'))).toBe(true)
    expect(asksWhetherToCancel('El martes 17 tengo las 15:00. ¿Te quito mientras tanto la cita del martes 10 a las 9:30?')).toBe(true)
    expect(asksWhetherToCancel('¿Te quito la del martes 10?')).toBe(true)
  })
})
