import { describe, it, expect } from 'vitest'
import { offeredTypesSection, rescheduleSection, typesForAudience, type PromptType } from '../../utils/receptionistTypes'
import { newPatientDetails } from '../../utils/receptionistTypes'

// Which appointment the receptionist offers depends on who is asking: the
// ad's first-visit offer for someone who answered the ad, the plain first
// visit for anyone else new, and never a first visit for a patient who has
// been before. Read from each type's stage and "bookable by".

const offer: PromptType = { name: 'Oferta Primera visita', durationMinutes: 60, stage: 'first_visit_offer', bookableBy: 'all' }
const first: PromptType = { name: 'Primera visita', durationMinutes: 60, stage: 'first_visit', bookableBy: 'all' }
const adjustment: PromptType = { name: 'Ajuste', durationMinutes: 15, stage: 'adjustment', bookableBy: 'all' }
const maintenance: PromptType = { name: 'Mantenimiento', durationMinutes: 15, stage: 'maintenance', bookableBy: 'existing_patients' }
const all = [offer, first, adjustment, maintenance]
const names = (list: PromptType[]) => list.map((type) => type.name)

describe('Receptionist types by audience', () => {
  it('offers the ad offer to someone from the ad, and nothing else', () => {
    const { types, adOnly } = typesForAudience(all, 'new_from_ad')
    expect(names(types)).toEqual(['Oferta Primera visita'])
    expect(adOnly).toEqual([])
  })

  it('offers the plain first visit to anyone else new, the offer only if they mention the ad', () => {
    const { types, adOnly } = typesForAudience(all, 'new')
    expect(names(types)).toEqual(['Primera visita'])
    expect(names(adOnly)).toEqual(['Oferta Primera visita'])
  })

  it('never offers a returning patient a first visit', () => {
    const { types, adOnly } = typesForAudience(all, 'existing')
    expect(names(types)).toEqual(['Ajuste', 'Mantenimiento'])
    expect(adOnly).toEqual([])
  })

  it('falls back to the plain first visit when a clinic has no offer type', () => {
    expect(names(typesForAudience([first, adjustment], 'new_from_ad').types)).toEqual(['Primera visita'])
  })

  it('leaves a clinic that set no stages as it was: every type, for everyone', () => {
    const plain = [{ name: 'Visita', durationMinutes: 30 }, { name: 'Ajuste', durationMinutes: 15 }]
    expect(names(typesForAudience(plain, 'new').types)).toEqual(['Visita', 'Ajuste'])
    expect(names(typesForAudience(plain, 'new_from_ad').types)).toEqual(['Visita', 'Ajuste'])
    expect(names(typesForAudience(plain, 'existing').types)).toEqual(['Visita', 'Ajuste'])
  })

  it('keeps types bookable only by existing patients away from new people, and the reverse', () => {
    const newOnly: PromptType = { name: 'Valoración', durationMinutes: 30, stage: 'other', bookableBy: 'new_patients' }
    expect(names(typesForAudience([newOnly, maintenance], 'new').types)).toEqual(['Valoración'])
    expect(names(typesForAudience([newOnly, maintenance], 'existing').types)).toEqual(['Mantenimiento'])
  })

  it('says when the ad offer applies', () => {
    const section = offeredTypesSection([first], [offer])
    expect(section).toContain('- Primera visita (60 min)')
    expect(section).toContain('The clinic also has a first-visit offer, which is NOT for everyone')
    expect(section).toContain('- Oferta Primera visita (60 min)')
    // Not volunteered to someone who has not said they qualify, never asked
    // about, and when given, the clinic's offer rather than "the ad's".
    expect(section).toContain('Do not mention it, and do not ask how they found the clinic: give them the regular first-visit price')
    expect(section).toContain('ahora mismo tenemos una oferta de primera visita')
    expect(section).not.toContain('nos has conocido por nuestro anuncio')
    expect(offeredTypesSection([first])).not.toContain('Oferta')
  })

  // Moving a visit keeps its type; cancelling stays with a person.
  it('moves a booked visit to a new time of the same type, and leaves cancelling to a colleague', () => {
    const visits = [{ startsAt: '2026-10-20T08:00:00Z', typeName: 'Ajuste' }]
    const section = rescheduleSection(visits, 'Europe/Madrid', { listVisits: true })
    expect(section).toContain('Tuesday 20 October at 10:00 (Ajuste)')
    expect(section).toContain('that same type of appointment')
    expect(section).toContain('cancel it instead, say your colleague will take care of it')
    expect(rescheduleSection(visits, 'Europe/Madrid', { listVisits: false })).not.toContain('(Ajuste)')
    expect(rescheduleSection([], 'Europe/Madrid', { listVisits: true })).toBe('')
  })
})


// A WhatsApp lead carries only a profile name; the patient record the
// receptionist makes from it takes the name and email they wrote instead.
describe('New patient details from the conversation', () => {
  it('takes the name as written, tidied', () => {
    expect(newPatientDetails('  Ana   García López. ', null)).toEqual({ fullName: 'Ana García López', email: null })
    expect(newPatientDetails('A', null).fullName).toBeNull()
    expect(newPatientDetails(42, null).fullName).toBeNull()
  })

  it('takes an email only when it is one', () => {
    expect(newPatientDetails(null, ' Ana.Garcia81@Gmail.com ').email).toBe('ana.garcia81@gmail.com')
    expect(newPatientDetails(null, 'not an email').email).toBeNull()
    expect(newPatientDetails(null, 'a@b').email).toBeNull()
  })
})
