import { describe, expect, it } from 'vitest'
import { acceptedUnbookedReason, confirmationInWords, confirmationIsPlain, matchAcceptedSlot, offerInWords, slotInWords, withOfferLead, wordsMatchOffer, type BookedDetails } from '../../utils/receptionistOffers'
import { clockTimes } from '../../utils/receptionistHistory'
import { slotTitle } from '../../utils/receptionistConversion'

// The receptionist's offers as data (utils/receptionistOffers.ts): which of
// the times somebody's answer accepts, and the words written from an offer
// or a booking when the model's are missing.

const SLOTS = [
  { date: '2026-12-02', time: '16:30', practitionerName: 'Marta Ríos' },
  { date: '2026-12-09', time: '17:15', practitionerName: 'Marta Ríos' },
]

describe('matchAcceptedSlot', () => {
  it('takes a tapped button as the time it names', () => {
    // 23 Nov 2026: the button's own title, as WhatsApp sends it back.
    expect(matchAcceptedSlot(SLOTS, ['miércoles 2 · 16:30'])).toEqual(SLOTS[0])
    expect(matchAcceptedSlot(SLOTS, [slotTitle(SLOTS[1]!, 'en')])).toEqual(SLOTS[1])
  })

  it('takes words that can only be one of the times', () => {
    expect(matchAcceptedSlot(SLOTS, ['El miércoles 9 me viene genial'])).toEqual(SLOTS[1])
    expect(matchAcceptedSlot(SLOTS, ['a las 16:30 perfecto'])).toEqual(SLOTS[0])
    expect(matchAcceptedSlot(SLOTS, ['la segunda'])).toEqual(SLOTS[1])
  })

  it('takes nothing that could be either, or neither', () => {
    // Both are a Wednesday.
    expect(matchAcceptedSlot(SLOTS, ['el miércoles'])).toBeNull()
    expect(matchAcceptedSlot(SLOTS, ['Otro día'])).toBeNull()
    expect(matchAcceptedSlot(SLOTS, ['Me gustaría cita por la tarde'])).toBeNull()
    expect(matchAcceptedSlot(SLOTS, ['el 9 no puedo'])).toBeNull()
    expect(matchAcceptedSlot(SLOTS, ['¿y el 9 a qué hora sería?'])).toBeNull()
  })

  it('takes nothing when they said more than the time', () => {
    expect(matchAcceptedSlot(SLOTS, ['miércoles 2 · 16:30', 'ah no, mejor otro día'])).toBeNull()
    expect(matchAcceptedSlot(SLOTS, ['miércoles 2 · 16:30', 'miércoles 9 · 17:15'])).toBeNull()
    expect(matchAcceptedSlot(SLOTS, ['miércoles 2 · 16:30', 'el miércoles 2'])).toEqual(SLOTS[0])
  })

  it('needs a tap to accept the only time offered', () => {
    const one = [SLOTS[0]!]
    expect(matchAcceptedSlot(one, ['miércoles 2 · 16:30'])).toEqual(SLOTS[0])
    expect(matchAcceptedSlot(one, ['vale'])).toBeNull()
  })
})

describe('an offer in words', () => {
  it('names each time and who they are with', () => {
    expect(offerInWords(SLOTS, 'es')).toBe('Tengo el miércoles 2 de diciembre a las 16:30 o el miércoles 9 de diciembre a las 17:15, con Marta. ¿Cuál te viene mejor?')
    expect(offerInWords([SLOTS[0]!], 'en')).toBe('I have Wednesday 2 December at 16:30, with Marta. Does that suit you?')
  })

  it('names nobody when the times are with different people', () => {
    expect(offerInWords([SLOTS[0]!, { ...SLOTS[1]!, practitionerName: 'Laura Vidal' }], 'es')).not.toContain('con ')
  })

  it('reads as the times it offers', () => {
    expect(wordsMatchOffer(clockTimes(offerInWords(SLOTS, 'es')), SLOTS)).toBe(true)
    expect(wordsMatchOffer(clockTimes(offerInWords(SLOTS, 'fr').replace(/(\d)h(\d)/g, '$1:$2')), SLOTS)).toBe(true)
  })
})

describe('wordsMatchOffer', () => {
  const named = (text: string) => clockTimes(text)
  it('wants every time under the reply named in it', () => {
    expect(wordsMatchOffer(named('Tengo el miércoles 2 a las 16:30. ¿Te va bien?'), SLOTS)).toBe(false)
  })

  it('lets their own visit be named beside them', () => {
    const text = 'Para cambiar tu cita del martes a las 19:45 tengo el miércoles 2 a las 16:30 o el miércoles 9 a las 17:15.'
    expect(wordsMatchOffer(named(text), SLOTS, { standing: new Set(['19:45']), max: 2 })).toBe(true)
    expect(wordsMatchOffer(named(text), SLOTS, { max: 2 })).toBe(false)
  })

  it('refuses more times than the clinic allows', () => {
    const text = 'Tengo el miércoles 2 a las 16:30, el miércoles 9 a las 17:15 o el jueves 10 a las 10:00.'
    expect(wordsMatchOffer(named(text), SLOTS, { max: 2 })).toBe(false)
    expect(wordsMatchOffer(named(text), SLOTS, { max: 3 })).toBe(true)
  })
})

describe('a confirmation in words', () => {
  const details: BookedDetails = { moved: true, typeName: 'Mantenimiento', slot: { date: '2026-12-02', time: '16:30' }, practitionerName: 'Marta Ríos', quiet: false, address: null, near: [], earlierOffer: false, repeatLateChange: false, forSomeoneElse: false }

  it('says where a moved visit is now, and with whom', () => {
    expect(confirmationInWords(details, 'es')).toBe('Hecho: tu cita queda cambiada al miércoles 2 de diciembre a las 16:30, con Marta.')
  })

  it('gives someone new the address and what follows', () => {
    const text = confirmationInWords({ ...details, moved: false, typeName: 'Primera visita', address: 'Calle Mayor 1, Valencia', earlierOffer: true }, 'es')
    expect(text).toBe('Reservado: Primera visita el miércoles 2 de diciembre a las 16:30, con Marta. Estamos en Calle Mayor 1, Valencia. Te llegará también la confirmación. Si se libera algo antes, te escribo.')
  })

  it('promises no confirmation to someone who asked for no automatic messages', () => {
    expect(confirmationInWords({ ...details, moved: false, quiet: true }, 'es')).not.toContain('confirmación')
  })

  it('asks about a visit close to the new one', () => {
    expect(confirmationInWords({ ...details, near: [{ date: '2026-12-03', time: '09:00' }] }, 'es')).toContain('También tienes cita el jueves 3 de diciembre a las 9:00. ¿La mantienes?')
  })

  it("leaves a repeated late change, and a visit for somebody else, to the model's words", () => {
    expect(confirmationIsPlain(details)).toBe(true)
    expect(confirmationIsPlain({ ...details, repeatLateChange: true })).toBe(false)
    expect(confirmationIsPlain({ ...details, forSomeoneElse: true })).toBe(false)
  })
})

describe('what a person is told about a time accepted and not booked', () => {
  it('names the time', () => {
    expect(acceptedUnbookedReason({ date: '2026-12-02', time: '09:05' })).toContain(slotInWords({ date: '2026-12-02', time: '09:05' }, 'es'))
    expect(slotInWords({ date: '2026-12-02', time: '09:05' }, 'es')).toBe('miércoles 2 de diciembre a las 9:05')
  })
})

describe('withOfferLead: the words beside offer_times, in front of the reply', () => {
  const lead = 'Hola, gracias por escribirnos. Vemos a muchos pacientes con dolor de espalda, y en la primera visita hacemos una valoración completa.'
  const times = 'Las dos opciones son:\n\n- Hoy, miércoles 25 de noviembre, a las 16:00, con Laura.\n- Mañana, jueves 26 de noviembre, a las 18:00, con Pablo.\n\n¿Cuál prefieres?'

  it('puts a greeting written beside the call before the times', () => {
    expect(withOfferLead(lead, times)).toBe(`${lead}\n\n${times}`)
  })

  it('puts times written beside the call before a question that follows', () => {
    const offer = 'Tengo el miércoles 25 a las 16:00 o el jueves 26 a las 18:00.'
    expect(withOfferLead(offer, '¿Cuál prefieres?')).toBe(`${offer}\n\n¿Cuál prefieres?`)
  })

  it('does not repeat words the reply already has', () => {
    expect(withOfferLead(lead, `${lead}\n\n${times}`)).toBe(`${lead}\n\n${times}`)
    // The same opening, worded on differently after it.
    expect(withOfferLead('Hola, Ana.\nTe cuento.', 'Hola, Ana.\n\nTengo hoy a las 16:00.')).toBe('Hola, Ana.\n\nTengo hoy a las 16:00.')
  })

  it('keeps only the reply when both offer times, so the list is not sent twice', () => {
    expect(withOfferLead('Te propongo el miércoles a las 16:00 o el jueves a las 18:00.', times)).toBe(times)
  })

  it('is the reply alone, or the lead alone, when the other is empty', () => {
    expect(withOfferLead('', times)).toBe(times)
    expect(withOfferLead('  ', times)).toBe(times)
    expect(withOfferLead(lead, '')).toBe(lead)
  })
})
