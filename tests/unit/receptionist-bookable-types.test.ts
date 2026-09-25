import { describe, it, expect } from 'vitest'
import { checkBookableIds, offeredAppointmentTypes, offeredTypesSection, receptionistOffersType } from '../../utils/receptionistTypes'

// The AI receptionist's list of appointment types was stored and read by
// nothing, so every clinic's receptionist offered any type. These pin the
// reading that replaced that: empty is still "any active type" (every
// production row is empty, and "none" would have silenced them all), a list
// restricts, and an archived type is never offered either way.

const types = [
  { id: 'a', name: 'Ajuste', duration_minutes: 30, archived_at: null, sort_order: 2 },
  { id: 'p', name: 'Primera visita', duration_minutes: 45, archived_at: null, sort_order: 1 },
  { id: 'r', name: 'Revisión', duration_minutes: 20, archived_at: '2026-09-20T10:00:00Z', sort_order: 0 },
  { id: 'm', name: 'Masaje', duration_minutes: 60, archived_at: null, sort_order: null },
]
const names = (list: { name: string }[]) => list.map((type) => type.name)

describe('Which types the receptionist offers', () => {
  it('offers every active type, in the clinic order, when the list is empty', () => {
    expect(names(offeredAppointmentTypes(types, []))).toEqual(['Primera visita', 'Ajuste', 'Masaje'])
  })

  it('offers only the listed types when there is a list', () => {
    expect(names(offeredAppointmentTypes(types, ['a', 'm']))).toEqual(['Ajuste', 'Masaje'])
  })

  it('never offers an archived type, even one on the list', () => {
    expect(names(offeredAppointmentTypes(types, ['r', 'a']))).toEqual(['Ajuste'])
  })

  it('offers nothing when every listed type is archived, rather than widening to all', () => {
    expect(offeredAppointmentTypes(types, ['r'])).toEqual([])
  })

  it('ignores an id that is not one of the clinic types', () => {
    expect(names(offeredAppointmentTypes(types, ['a', 'someone-elses']))).toEqual(['Ajuste'])
  })

  it('answers the same question for a single type', () => {
    expect(receptionistOffersType({ id: 'a', archived_at: null }, [])).toBe(true)
    expect(receptionistOffersType({ id: 'a', archived_at: null }, ['p'])).toBe(false)
    expect(receptionistOffersType({ id: 'r', archived_at: '2026-09-20T10:00:00Z' }, [])).toBe(false)
    expect(receptionistOffersType({ id: 'r', archived_at: '2026-09-20T10:00:00Z' }, ['r'])).toBe(false)
  })
})

describe('What the prompt is told', () => {
  it('names each offered type and says to offer nothing else', () => {
    const text = offeredTypesSection([{ name: 'Primera visita', durationMinutes: 45 }])
    expect(text).toContain('- Primera visita (45 min)')
    expect(text).toContain('Offer only these')
  })

  it('says to offer no times when there is nothing to offer', () => {
    const text = offeredTypesSection([])
    expect(text).toContain('Do not offer times')
    expect(text).not.toContain('Only these types')
  })
})

describe('Saving the list', () => {
  it('takes active types of this clinic, once each', () => {
    expect(checkBookableIds(['a', 'p', 'a'], types)).toEqual({ ids: ['a', 'p'] })
  })

  it('takes an empty list, which means any active type', () => {
    expect(checkBookableIds([], types)).toEqual({ ids: [] })
  })

  it('refuses an archived type by name', () => {
    expect(checkBookableIds(['a', 'r'], types)).toEqual({ error: '«Revisión» is archived, so the receptionist cannot offer it' })
  })

  it('refuses a type that is not this clinic', () => {
    expect(checkBookableIds(['someone-elses'], types)).toHaveProperty('error')
  })

  it('refuses something that is not a list of ids', () => {
    expect(checkBookableIds('a', types)).toHaveProperty('error')
    expect(checkBookableIds([1], types)).toHaveProperty('error')
  })
})
