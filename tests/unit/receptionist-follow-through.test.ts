import { describe, expect, it } from 'vitest'
import { asksToChangeVisit, asksWhetherToCancel, cancelQuestionDue, offersTimes, chosenOfferedTime, chosenTimeNote, handoverReasonSaysNothing, isUnheardVoiceNote, offeredTimes, sendFailedReason, VOICE_NOTE_REPLY } from '../../utils/receptionistFollowThrough'
import { BASE_BEHAVIOUR, BASE_ESCALATIONS } from '../../utils/receptionistBaseRules'
import { CONFIRM_BEFORE_BOOKING, phoneSharersSection } from '../../utils/receptionistTypes'
import { COLLEAGUE_MARK, historyMarkersSection, VOICE_NOTE_TRANSCRIPT_MARK } from '../../utils/receptionistHistory'

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
  it('answers a voice note it could not hear with the fixed words the escalation rule gives', () => {
    expect(isUnheardVoiceNote('audio')).toBe(true)
    expect(isUnheardVoiceNote('audio', null)).toBe(true)
    expect(isUnheardVoiceNote('audio', '   ')).toBe(true)
    expect(isUnheardVoiceNote('image')).toBe(false)
    expect(BASE_ESCALATIONS.find((r) => r.rule.includes('voice note'))!.action).toContain(VOICE_NOTE_REPLY.replace(/\.$/, ''))
  })

  // 20 Nov 2026: transcription shipped on the 18th, but the check still looked
  // at the media type alone, so a transcribed voice note got the fixed reply.
  it('lets a transcribed voice note through to the model', () => {
    expect(isUnheardVoiceNote('audio', 'Hola, quería pedir cita para el jueves')).toBe(false)
    const rule = BASE_ESCALATIONS.find((r) => r.rule.includes('voice note'))!.rule
    expect(rule).toContain('[Voice note -- you cannot listen to it]')
    expect(rule).toContain(VOICE_NOTE_TRANSCRIPT_MARK)
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

// An offer answered the next day: "mañana" in it is a day old (19 Nov 2026).
describe('A chosen time from an offer sent on an earlier day', () => {
  const offer = 'Te ofrezco: hoy mismo a las 17:30 o mañana jueves a las 15:00. ¿Te viene bien alguna?'
  const days = { sentOn: '2026-11-18', today: '2026-11-19' }

  it('names the date "mañana" meant, not tomorrow', () => {
    const note = chosenTimeNote(chosenOfferedTime(offer, 'la de las 15:00')!, true, days)
    expect(note).toContain('Thursday 19 November 2026 at 15:00')
    expect(note).not.toContain('tomorrow')
    expect(note).toContain('book_appointment')
  })

  it('does not book a time whose day has passed', () => {
    const note = chosenTimeNote(chosenOfferedTime(offer, 'a las 17:30')!, true, days)
    expect(note).toContain('that day has passed')
    expect(note).not.toContain('Book it now')
  })

  it('reads as before when the offer is from today', () => {
    const today = { sentOn: '2026-11-19', today: '2026-11-19' }
    expect(chosenTimeNote(chosenOfferedTime(offer, 'la de las 15:00')!, true, today)).toContain('tomorrow at 15:00')
  })

  it('keeps a weekday to the one after the offer', () => {
    const weekly = 'Puedo ofrecerte el martes 24 a las 9:00 o el jueves 26 a las 15:30. ¿Cuál prefieres?'
    expect(chosenTimeNote(chosenOfferedTime(weekly, 'el jueves')!, true, days)).toContain('never a week later')
  })
})

// 19 Nov 2026: a handover reached the Inbox banner, the note, the push and
// the task with the reason "placeholder".
describe('handoverReasonSaysNothing', () => {
  it('refuses an empty, one-word or filler reason', () => {
    for (const reason of ['', 'placeholder', 'Placeholder.', 'TODO', '...', 'n/a', 'No reason given', 'sin motivo', 'reason here', 'x y']) {
      expect(handoverReasonSaysNothing(reason), reason).toBe(true)
    }
  })

  it('accepts a short real reason', () => {
    for (const reason of ['Quiere cancelar', 'Pregunta por una factura de octubre.', 'Wants a refund', 'Llega tarde a su cita de las 15:00 y pregunta si puede venir.']) {
      expect(handoverReasonSaysNothing(reason), reason).toBe(false)
    }
  })
})

// A colleague offered two times, the patient took one, and the receptionist
// handed it back to a person instead of moving the visit (23 Nov 2026).
describe('A time a colleague offered', () => {
  const offer = `${COLLEAGUE_MARK}\nBuenos dias, como tendrias el martes 1 a las 19:15? Es lo mas tarde que tengo ese dia, o el miercoles 2 a las 19:30?`

  it('reads the answer as one of the colleague\'s times', () => {
    expect(chosenOfferedTime(offer, 'El miércoles 2 me viene genial')).toMatchObject({ weekday: 'miercoles', dayOfMonth: 2, time: '19:30' })
  })

  it('books it, and hands over only if it cannot be booked', () => {
    const note = chosenTimeNote(chosenOfferedTime(offer, 'El miércoles 2 me viene genial')!, true, undefined, 'colleague')
    expect(note).toContain('your colleague offered')
    expect(note).toContain('miercoles 2 at 19:30')
    expect(note).toContain('Book it now yourself with book_appointment')
    expect(note).toContain('do not offer other times instead')
  })

  it('says so in the conversation marks too', () => {
    const section = historyMarkersSection(true)
    expect(section).toContain('If the patient accepts a time a colleague offered, book it yourself')
    expect(section).not.toContain('if the patient accepts a time or an arrangement a colleague offered, call hand_over_to_colleague')
  })

  it('is unchanged for its own offers', () => {
    const note = chosenTimeNote(chosenOfferedTime(offer, 'el 2')!, true)
    expect(note).toContain('the times you offered in your last message')
    expect(note).not.toContain('hand_over_to_colleague')
  })
})
