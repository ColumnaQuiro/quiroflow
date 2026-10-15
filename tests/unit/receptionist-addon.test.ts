import { describe, expect, it } from 'vitest'
import { receptionistLineWanted } from '../../utils/growthPlans'
import { pricePerMonth } from '../../utils/billing'

// The AI receptionist is sold on its own and is also part of Growth
// (20261014184755_receptionist_addon.sql). What must never happen is a clinic
// paying for it twice: once as its own line and once inside Growth.

describe('The receptionist as its own line item', () => {
  it('is billed when asked for on a plan without Growth', () => {
    expect(receptionistLineWanted({ receptionist: true, growth: false, planId: 'starter' })).toBe(true)
  })

  it('is dropped when Growth is bought alongside it', () => {
    expect(receptionistLineWanted({ receptionist: true, growth: true, planId: 'starter' })).toBe(false)
  })

  it('is dropped on a plan that includes Growth', () => {
    expect(receptionistLineWanted({ receptionist: true, growth: false, planId: 'clinic' })).toBe(false)
  })

  it('is not added when nobody asked for it', () => {
    expect(receptionistLineWanted({ growth: false, planId: 'starter' })).toBe(false)
  })
})

describe('What a month with the receptionist costs', () => {
  const plan = { monthlyPriceCents: 4900, annualPriceCents: 4400, extraProfessionalPriceCents: 1900 }
  const receptionist = { monthlyPriceCents: 1900, annualPriceCents: 1700 }

  it('adds 19 a month, or 17 billed annually', () => {
    expect(pricePerMonth(plan, { interval: 'monthly', extraProfessionals: 0, growthBilled: false, receptionistBilled: true }, null, null, receptionist)).toBe(6800)
    expect(pricePerMonth(plan, { interval: 'annual', extraProfessionals: 0, growthBilled: false, receptionistBilled: true }, null, null, receptionist)).toBe(6100)
  })

  it('adds nothing when it is not billed on its own', () => {
    expect(pricePerMonth(plan, { interval: 'monthly', extraProfessionals: 0, growthBilled: false }, null, null, receptionist)).toBe(4900)
  })
})
