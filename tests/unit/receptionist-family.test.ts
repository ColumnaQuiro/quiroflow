import { describe, it, expect } from 'vitest'
import { familySection, matchChild, minorsSection, type PromptType } from '../../utils/receptionistTypes'

// Booking for an adult in the family of the person writing
// (utils/receptionistTypes.ts familySection). A patient asked for a visit for
// her and her husband and was told twice that he had to write himself,
// although he was a patient too. Only people linked as family on the
// clinic's records are booked for; anyone else named goes to a person, and
// nothing is said about whether they are a patient.

const first: PromptType = { name: 'Primera visita', durationMinutes: 60, stage: 'first_visit', bookableBy: 'all' }
const adjustment: PromptType = { name: 'Ajuste Quiropractico', durationMinutes: 15, stage: 'adjustment', bookableBy: 'all' }
const partner = { firstName: 'Marco', lastName: 'Bianchi', relation: 'partner', hasBeenBefore: true }

describe('Receptionist booking for family', () => {
  it('lists the family on file and books them by name, with their own types', () => {
    const s = familySection({ forNew: [first], forReturning: [adjustment], members: [partner], canBook: true, sendsItself: true })
    expect(s).toContain('- Marco Bianchi, their partner (has been to the clinic)')
    expect(s).toContain('"Ajuste Quiropractico"')
    expect(s).toContain('call book_appointment with family_member_name')
  })

  it('hands anyone not linked to a person, without saying whether they are a patient', () => {
    const s = familySection({ forNew: [first], forReturning: [adjustment], members: [], canBook: true, sendsItself: true })
    expect(s).not.toContain('family_member_name')
    expect(s).toContain('call hand_over_to_colleague with that person\'s full name')
    expect(s).toContain('never say whether someone not listed above is a patient')
    expect(s).toContain('Never tell them that person has to write to the clinic themselves.')
  })

  it('no longer tells the person writing that an adult must write themselves', () => {
    const s = minorsSection({ forNewChild: [first], forReturningChild: [adjustment], children: [], canBook: true, sendsItself: true })
    expect(s).not.toContain('Ask them to write to the clinic themselves')
    expect(s).toContain('Never tell them that person has to write to the clinic themselves.')
  })

  it('matches a relative by first name, and refuses two with the same one', () => {
    expect(matchChild([partner], 'marco')).toBe(partner)
    expect(matchChild([partner, { ...partner, lastName: 'Rossi' }], 'Marco')).toBe('ambiguous')
    expect(matchChild([partner], 'Luca')).toBeNull()
  })
})
