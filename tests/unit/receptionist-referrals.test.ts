import { describe, it, expect } from 'vitest'
import {
  accentBlindPrefix,
  familySection,
  inverseRelation,
  matchReferrer,
  minorsSection,
  offeredTypesSection,
  referralSection,
  someoneTheyBringSection,
  typesForAudience,
  typesForMinor,
  typesForReferral,
  typesForSomeoneTheyBring,
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
    expect(names(typesForSomeoneTheyBring(all))).toEqual(['Primera Visita Referido'])
    expect(names(typesForSomeoneTheyBring([first, offer, adjustment]))).toEqual(['Primera visita'])
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

describe('Family links for someone they bring', () => {
  it('records the link from the other side', () => {
    expect(inverseRelation('partner')).toBe('partner')
    expect(inverseRelation('parent')).toBe('child')
    expect(inverseRelation('child')).toBe('parent')
  })
})

describe('Prompt sections for someone they bring and referrals', () => {
  it('books someone they bring in their own name, and gives a visit already booked', () => {
    const text = someoneTheyBringSection({ types: [referred], canBook: true, canGive: true, sendsItself: true })
    expect(text).toContain('"Primera Visita Referido"')
    expect(text).toContain('other_person_name, other_person_phone')
    expect(text).toContain('give_visit_to')
  })

  it('hands a visit that is someone else\'s over when it cannot give it', () => {
    const text = someoneTheyBringSection({ types: [referred], canBook: false, canGive: false, sendsItself: true })
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
