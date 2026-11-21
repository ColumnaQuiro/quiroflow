import { describe, expect, it } from 'vitest'
import { RECEPTIONIST_TRIAL_REPLIES, monthNameEs, previousMonthStart, receptionistAllowanceLevel, receptionistExtraBlocks, receptionistLimitReached, receptionistOnTrialAllowance } from '../../utils/receptionistAllowance'

// What the receptionist's price includes (1,000 replies a month) and what is
// charged past it (EUR 15 per further 1,000, a part block counting whole).
// The usage card and the monthly charge both read these, so they are pinned.

describe('Extra blocks past the included replies', () => {
  it('charges nothing up to and including the 1,000th reply', () => {
    expect(receptionistExtraBlocks(0)).toBe(0)
    expect(receptionistExtraBlocks(1000)).toBe(0)
  })

  it('counts a part block as a whole one', () => {
    expect(receptionistExtraBlocks(1001)).toBe(1)
    expect(receptionistExtraBlocks(2000)).toBe(1)
    expect(receptionistExtraBlocks(2001)).toBe(2)
  })
})

describe('How far into the allowance a month is', () => {
  it('warns from 80% and says when it is used up', () => {
    expect(receptionistAllowanceLevel(799)).toBe('ok')
    expect(receptionistAllowanceLevel(800)).toBe('near')
    expect(receptionistAllowanceLevel(999)).toBe('near')
    expect(receptionistAllowanceLevel(1000)).toBe('over')
  })
})

describe("The clinic's own monthly ceiling", () => {
  it('stops it once the count reaches the ceiling, and never without one', () => {
    expect(receptionistLimitReached(49, 50)).toBe(false)
    expect(receptionistLimitReached(50, 50)).toBe(true)
    expect(receptionistLimitReached(5000, null)).toBe(false)
    expect(receptionistLimitReached(5000, undefined)).toBe(false)
  })
})

// The free trial has the receptionist, on an allowance of its own, until it
// buys something that includes it. A trial is charged for no reply, so the
// allowance is what bounds what a trial costs.
describe("The trial's allowance", () => {
  it('is 200 replies', () => {
    expect(RECEPTIONIST_TRIAL_REPLIES).toBe(200)
  })

  it('holds a trial that has bought nothing', () => {
    expect(receptionistOnTrialAllowance({ status: 'trialing', plan_id: 'starter' })).toBe(true)
  })

  it('lifts once it has bought the add-on, Growth, or a plan with Growth', () => {
    expect(receptionistOnTrialAllowance({ status: 'trialing', plan_id: 'starter', receptionist_addon: true })).toBe(false)
    expect(receptionistOnTrialAllowance({ status: 'trialing', plan_id: 'starter', growth_addon: true })).toBe(false)
    expect(receptionistOnTrialAllowance({ status: 'trialing', plan_id: 'pro' })).toBe(false)
  })

  it('never applies to a complimentary account, or outside a trial', () => {
    expect(receptionistOnTrialAllowance({ status: 'trialing', plan_id: 'starter', comped: true })).toBe(false)
    expect(receptionistOnTrialAllowance({ status: 'active', plan_id: 'starter', receptionist_addon: true })).toBe(false)
    expect(receptionistOnTrialAllowance(null)).toBe(false)
  })
})

// The charge on the 1st is for the month before, on the clinic's clock.
describe('The month the charge is for', () => {
  it('is the month before, across a year end too', () => {
    expect(previousMonthStart('2026-11-01')).toBe('2026-10-01')
    expect(previousMonthStart('2027-01-01')).toBe('2026-12-01')
  })

  it('is named the way a Spanish clinic reads its invoice', () => {
    expect(monthNameEs('2026-10-01')).toBe('octubre de 2026')
  })
})
