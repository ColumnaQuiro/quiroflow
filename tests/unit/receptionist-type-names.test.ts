import { describe, expect, it } from 'vitest'
import { findTypeByName } from '../../utils/receptionistTypes'

// Which type a name the receptionist wrote means (findTypeByName). Compared
// exactly, "Primera visita" refused the booking of a lead from the ad whose
// only first visit was the offer, and the model handed them to a person
// instead of trying again (4 Nov 2026).
describe('The type a written name means', () => {
  const offer = { name: 'Oferta Primera visita' }
  const first = { name: 'Primera visita' }
  const referral = { name: 'Primera Visita Referido' }
  const adjustment = { name: 'Ajuste Quiropractico' }
  const maintenance = { name: 'Mantenimiento Quiropractico' }

  it('ignores accents and case', () => {
    expect(findTypeByName([adjustment, maintenance], 'Ajuste Quiropráctico')).toBe(adjustment)
    expect(findTypeByName([adjustment, maintenance], 'ajuste quiropractico')).toBe(adjustment)
  })

  it('takes the only type whose name contains the one written', () => {
    expect(findTypeByName([offer], 'Primera visita')).toBe(offer)
    expect(findTypeByName([adjustment, maintenance], 'Mantenimiento')).toBe(maintenance)
  })

  it('prefers an exact name to one that only contains it', () => {
    expect(findTypeByName([first, offer, referral], 'Primera visita')).toBe(first)
  })

  it('will not guess between two', () => {
    expect(findTypeByName([offer, referral], 'Primera visita')).toBeUndefined()
    expect(findTypeByName([adjustment, maintenance], 'Quiropractico')).toBeUndefined()
    expect(findTypeByName([adjustment, maintenance], 'Masaje')).toBeUndefined()
  })

  it('takes the only type there is when none is named', () => {
    expect(findTypeByName([offer], '')).toBe(offer)
    expect(findTypeByName([offer], undefined)).toBe(offer)
    expect(findTypeByName([adjustment, maintenance], '')).toBeUndefined()
  })
})
