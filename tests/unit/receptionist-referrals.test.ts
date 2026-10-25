import { describe, it, expect } from 'vitest'
import {
  accentBlindPrefix,
  familySection,
  matchReferrer,
  minorsSection,
  offeredTypesSection,
  laterPricesSection,
  quotedTypes,
  referralSection,
  someoneTheyBringSection,
  typesForAudience,
  typesForMinor,
  typesForReferral,
  typesForSomeoneTheyBring,
  typePrice,
  typesAfterFirstVisit,
  type PromptType,
} from '../../utils/receptionistTypes'

// Someone new the person writing brings, and someone referred by a patient
// (utils/receptionistTypes.ts). A first visit booked by someone who then
// wrote "es para mi pareja" stayed in his name until a person moved it, and
// the clinic's referral first visit could only be booked by hand.

const first: PromptType = { name: 'Primera visita', durationMinutes: 60, stage: 'first_visit', bookableBy: 'all' }
const offer: PromptType = { name: 'Oferta Primera visita', durationMinutes: 60, stage: 'first_visit_offer', bookableBy: 'all' }
const referred: PromptType = { name: 'Primera Visita Referido', durationMinutes: 60, stage: 'first_visit', bookableBy: 'all', forReferrals: true }
const childFirst: PromptType = { name: 'Primera visita niño', durationMinutes: 45, stage: 'first_visit', bookableBy: 'all', forMinors: true }
const adjustment: PromptType = { name: 'Ajuste', durationMinutes: 15, stage: 'adjustment', bookableBy: 'all' }
const all = [first, offer, referred, childFirst, adjustment]
const names = (list: PromptType[]) => list.map((type) => type.name)

describe('Receptionist types for referrals', () => {
  it('never offers the referral visit on its own, to anyone', () => {
    for (const audience of ['new', 'new_from_ad', 'existing'] as const) {
      const { types, adOnly } = typesForAudience(all, audience)
      expect(names([...types, ...adOnly])).not.toContain('Primera Visita Referido')
    }
    expect(names(typesForMinor(all, false))).not.toContain('Primera Visita Referido')
  })

  it('is the referral first visit for someone referred', () => {
    expect(names(typesForReferral(all))).toEqual(['Primera Visita Referido'])
  })

  it('offers someone they bring the referral visit, or the plain first visit when there is none', () => {
    expect(names(typesForSomeoneTheyBring(all, true))).toEqual(['Primera Visita Referido'])
    expect(names(typesForSomeoneTheyBring([first, offer, adjustment], true))).toEqual(['Primera visita'])
  })

  it('is no referral when the person writing has never been to the clinic', () => {
    expect(names(typesForSomeoneTheyBring(all, false))).toEqual(['Primera visita'])
    const text = someoneTheyBringSection({ types: [first], referred: false, canBook: true, canGive: true, sendsItself: true })
    expect(text).not.toContain('referred by the person writing')
    expect(text).toContain('this is not a referral')
  })
})

describe('Which patient a referral names', () => {
  const ana = { firstName: 'Ana', lastName: 'García López' }
  const other = { firstName: 'Ana María', lastName: 'Pérez' }

  it('needs a surname', () => {
    expect(matchReferrer([ana], 'Ana')).toBe('need_surname')
  })

  it('matches first name and every surname given, ignoring accents', () => {
    expect(matchReferrer([ana, other], 'ana garcia')).toBe(ana)
    expect(matchReferrer([ana, other], 'Ana García López')).toBe(ana)
    expect(matchReferrer([ana, other], 'Ana Pérez')).toBe(other)
  })

  it('is nobody for a surname that is not theirs', () => {
    expect(matchReferrer([ana], 'Ana Martín')).toBeNull()
  })

  it('will not pick between two patients with that name', () => {
    expect(matchReferrer([ana, { firstName: 'Ana', lastName: 'García Ruiz' }], 'Ana García')).toBe('ambiguous')
  })

  it('reads a first name whatever its accents', () => {
    expect(accentBlindPrefix('Lucía')).toBe('l_c__%')
    expect(accentBlindPrefix('Iñigo')).toBe('___g_%')
  })
})

describe('Prompt sections for someone they bring and referrals', () => {
  it('books someone they bring in their own name, and gives a visit already booked', () => {
    const text = someoneTheyBringSection({ types: [referred], referred: true, canBook: true, canGive: true, sendsItself: true })
    expect(text).toContain('"Primera Visita Referido"')
    expect(text).toContain('other_person_name, other_person_phone')
    expect(text).toContain('give_visit_to')
  })

  it('hands a visit that is someone else\'s over when it cannot give it', () => {
    const text = someoneTheyBringSection({ types: [referred], referred: true, canBook: false, canGive: false, sendsItself: true })
    expect(text).not.toContain('give_visit_to')
    expect(text).toContain('hand_over_to_colleague')
  })

  it('says nothing about referrals without a referral visit', () => {
    expect(referralSection({ types: [], canBook: true, sendsItself: true })).toBe('')
  })

  it('asks who referred them before booking the referral visit', () => {
    const text = referralSection({ types: [referred], canBook: true, sendsItself: true })
    expect(text).toContain('first name and surname of the patient who referred them')
    expect(text).toContain('referred_by')
  })

  it('stops sending a recommended person to the ad offer when there is a referral visit', () => {
    expect(offeredTypesSection([first], [offer])).toContain('or were recommended')
    expect(offeredTypesSection([first], [offer], { referralVisit: true })).not.toContain('or were recommended')
  })

  it('points the children and family sections at it for anyone not on file', () => {
    const minors = minorsSection({ forNewChild: [childFirst], forReturningChild: [adjustment], children: [], canBook: true, sendsItself: true, bringsSomeone: true })
    expect(minors).toContain('see "Someone new they bring"')
    const family = familySection({ forNew: [referred], forReturning: [adjustment], members: [], canBook: true, sendsItself: true, bringsSomeone: true })
    expect(family).toContain('see "Someone new they bring"')
  })
})

// Prices come from the types themselves (appointment_types.default_price_cents):
// a knowledge card naming a price is a second copy, and the referral first
// visit had none until someone wrote one.
describe('Prices in the prompt', () => {
  const priced = { ...referred, priceCents: 5000 }

  it("says a type's price in euros, and nothing for a type without one", () => {
    expect(typePrice(priced)).toBe('50 €')
    expect(typePrice({ ...first, priceCents: 5250 })).toBe('52,50 €')
    expect(typePrice({ ...first, priceCents: 0 })).toBe('')
    expect(typePrice(first)).toBe('')
    expect(typePrice({ ...first, priceCents: 7000, priceVaries: true })).toBe('70 €, may differ by practitioner')
  })

  it('lists each type with its price, and says it wins over the knowledge', () => {
    const text = offeredTypesSection([{ ...first, priceCents: 7000 }])
    expect(text).toContain('- Primera visita (60 min, 70 €)')
    expect(text).toContain('even if the clinic knowledge names another')
    expect(offeredTypesSection([first])).not.toContain('clinic knowledge names another')
  })

  it('names the price in the other sections too', () => {
    expect(quotedTypes([priced, adjustment])).toBe('"Primera Visita Referido" (50 €), "Ajuste"')
    expect(referralSection({ types: [priced], canBook: true, sendsItself: true })).toContain('"Primera Visita Referido" (50 €)')
  })
})

// What comes after the first visit, and the bonos: from the types and from
// Settings > Bonos, so a clinic need not write its prices on a card.
describe('Prices after the first visit', () => {
  const session = { ...adjustment, priceCents: 5500 }

  it('lists the visits after the first, never a first visit or a type without a price', () => {
    expect(names(typesAfterFirstVisit([{ ...first, priceCents: 7000 }, session, adjustment, { ...referred, priceCents: 5000 }]))).toEqual(['Ajuste'])
  })

  it('lists the sessions and the bonos with their price a session', () => {
    const text = laterPricesSection({ sessions: [session], packages: [{ name: 'Bono 10 sesiones', sessions: 10, priceCents: 46000 }] })
    expect(text).toContain('- Ajuste: 55 €')
    expect(text).toContain('- Bono 10 sesiones: 10 sessions for 460 € (46 € a session)')
  })

  it('says nothing when there is nothing to price', () => {
    expect(laterPricesSection({ sessions: [], packages: [{ name: 'Bono', sessions: 0, priceCents: 0 }] })).toBe('')
  })
})
