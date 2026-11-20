import { describe, it, expect } from 'vitest'
import { checkoutDefaultChoice } from '../../utils/bonoOrder'

// What the visit checkout opens selected. A patient with two bonos (their own
// and a family one shared with them) must not have one picked for them: the
// front desk decides which pays for the visit.
describe('checkoutDefaultChoice', () => {
  it('opens on money when the patient holds no bono', () => {
    expect(checkoutDefaultChoice([])).toBe('money')
  })

  it('opens on the bono when the patient holds exactly one', () => {
    expect(checkoutDefaultChoice([{ id: 'own' }])).toBe('own')
  })

  it('opens on nothing when the patient holds two or more', () => {
    expect(checkoutDefaultChoice([{ id: 'own' }, { id: 'shared' }])).toBe('')
    expect(checkoutDefaultChoice([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe('')
  })
})
