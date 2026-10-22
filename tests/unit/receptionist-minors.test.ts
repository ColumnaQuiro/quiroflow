import { describe, it, expect } from 'vitest'
import { matchChild, minorsSection, typesForAudience, typesForMinor, type PromptType } from '../../utils/receptionistTypes'

// Booking for someone's child (utils/receptionistTypes.ts). A patient asked
// for a first visit for their daughter and was told there was none: the
// prompt assumed the person writing was always the patient, and a returning
// patient is never offered a first visit. The child is now the patient, with
// the person writing as tutor, and has a list of types of their own.

const first: PromptType = { name: 'Primera visita', durationMinutes: 60, stage: 'first_visit', bookableBy: 'all' }
const offer: PromptType = { name: 'Oferta Primera visita', durationMinutes: 60, stage: 'first_visit_offer', bookableBy: 'all' }
const childFirst: PromptType = { name: 'Primera visita niño', durationMinutes: 45, stage: 'first_visit', bookableBy: 'all', forMinors: true }
const adjustment: PromptType = { name: 'Ajuste', durationMinutes: 15, stage: 'adjustment', bookableBy: 'all' }
const maintenance: PromptType = { name: 'Mantenimiento', durationMinutes: 15, stage: 'maintenance', bookableBy: 'existing_patients' }
const newOnly: PromptType = { name: 'Valoración', durationMinutes: 30, stage: 'other', bookableBy: 'new_patients' }
const all = [first, offer, childFirst, adjustment, maintenance, newOnly]
const names = (list: PromptType[]) => list.map((type) => type.name)

describe('Receptionist types for a child', () => {
  it('offers a new child the clinic\'s child first visit, and only that', () => {
    expect(names(typesForMinor(all, false))).toEqual(['Primera visita niño'])
  })

  it('falls back to the plain first visit, never the ad offer, when there is no child type', () => {
    expect(names(typesForMinor([first, offer, adjustment], false))).toEqual(['Primera visita'])
  })

  it('offers a child who has been the follow-up visits, never a first visit', () => {
    expect(names(typesForMinor(all, true))).toEqual(['Ajuste', 'Mantenimiento'])
  })

  it('never offers the child type to an adult', () => {
    for (const audience of ['new', 'new_from_ad', 'existing'] as const) {
      const { types, adOnly } = typesForAudience(all, audience)
      expect(names([...types, ...adOnly])).not.toContain('Primera visita niño')
    }
  })
})

describe('Which child on file a name means', () => {
  const lucia = { firstName: 'Lucía', lastName: 'Gómez Ruiz' }
  const pablo = { firstName: 'Pablo', lastName: 'Gómez Ruiz' }

  it('finds a child by first name, ignoring accents and case', () => {
    expect(matchChild([lucia, pablo], 'lucia')).toBe(lucia)
    expect(matchChild([lucia, pablo], 'Lucía Gómez')).toBe(lucia)
  })

  it('is nobody on file for a new name, or a surname that does not match', () => {
    expect(matchChild([lucia, pablo], 'Marta')).toBeNull()
    expect(matchChild([lucia], 'Lucía Pérez')).toBeNull()
  })

  it('will not pick between two children with the same first name', () => {
    const other = { firstName: 'Lucía', lastName: 'Martín' }
    expect(matchChild([lucia, other], 'Lucía')).toBe('ambiguous')
    expect(matchChild([lucia, other], 'Lucía Martín')).toBe(other)
  })
})

describe('Prompt section for children', () => {
  const opts = { forNewChild: [childFirst], forReturningChild: [adjustment], children: [], canBook: true, sendsItself: true }

  it('names the types for a new and a returning child, and the age limit', () => {
    const text = minorsSection(opts)
    expect(text).toContain('"Primera visita niño"')
    expect(text).toContain('For a child who has been: "Ajuste"')
    expect(text).toContain('Under 18')
    expect(text).toContain('18 or over')
  })

  it('tells it how to book only when it can', () => {
    expect(minorsSection(opts)).toContain('child_name and child_age')
    expect(minorsSection({ ...opts, canBook: false })).not.toContain('child_name')
  })

  it('lists the children already on file', () => {
    const text = minorsSection({ ...opts, children: [{ firstName: 'Lucía', lastName: 'Gómez', hasBeenBefore: true }] })
    expect(text).toContain('- Lucía Gómez (has been to the clinic)')
  })
})

describe('Children the records suggest are theirs', () => {
  const section = (children: Parameters<typeof minorsSection>[0]['children']) =>
    minorsSection({ forNewChild: [childFirst], forReturningChild: [adjustment], children, canBook: true, sendsItself: true })

  it('lists them apart, asks their names first, and books them as the existing record', () => {
    const text = section([
      { firstName: 'Lia', lastName: 'Prueba', hasBeenBefore: true, linked: false, age: 7 },
      { firstName: 'Teo', lastName: 'Prueba', hasBeenBefore: true, linked: false, age: null },
    ])
    expect(text).toContain('Probably also their children')
    expect(text).toContain('- Lia Prueba, 7 (has been to the clinic)')
    expect(text).toContain('- Teo Prueba (has been to the clinic)')
    expect(text).toContain('ask the children\'s names and ages; never say these names first')
    expect(text).toContain('never make another record')
    expect(text).not.toContain('already on file with them as tutor')
  })

  it('keeps linked children where they were, and sends a child\'s times to their own practitioner', () => {
    const text = section([{ firstName: 'Ana', lastName: null, hasBeenBefore: true }])
    expect(text).toContain('already on file with them as tutor:\n- Ana (has been to the clinic)')
    expect(text).not.toContain('Probably also their children')
    expect(text).toContain('find_free_times and for_name')
  })
})
