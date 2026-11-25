import { describe, it, expect } from 'vitest'
import { CLINIC_REFERRAL_DISCOUNT_PERCENT, clinicReferralRewardCents, invoiceCouponIds, referralRewardAction, sharesAnOwner, type ReferralInvoiceView } from '../../utils/clinicReferral'

const invoice = (over: Partial<ReferralInvoiceView> = {}): ReferralInvoiceView => ({ status: 'draft', total: 5445, discounts: [], ...over })
const pending = { status: 'pending', stripe_coupon_id: null }

describe('clinicReferralRewardCents', () => {
  it('is 10% of the monthly plan price', () => {
    expect(CLINIC_REFERRAL_DISCOUNT_PERCENT).toBe(10)
    expect(clinicReferralRewardCents(4500)).toBe(450)
    expect(clinicReferralRewardCents(9900)).toBe(990)
  })
  it('rounds to the cent', () => {
    expect(clinicReferralRewardCents(4995)).toBe(500)
  })
  it('is nothing for a plan with no price', () => {
    expect(clinicReferralRewardCents(0)).toBeNull()
    expect(clinicReferralRewardCents(null)).toBeNull()
    expect(clinicReferralRewardCents(undefined)).toBeNull()
  })
})

describe('invoiceCouponIds', () => {
  it('reads coupons from expanded discounts, as id or object', () => {
    const ids = invoiceCouponIds({
      discounts: [{ id: 'di_1', source: { coupon: 'co_a' } }, { id: 'di_2', source: { coupon: { id: 'co_b' } } }, 'di_unexpanded'],
    })
    expect([...ids].sort()).toEqual(['co_a', 'co_b'])
  })
})

describe('referralRewardAction', () => {
  it('attaches to a draft with something to pay', () => {
    expect(referralRewardAction(pending, invoice())).toBe('attach')
  })
  it('leaves a 0 EUR trial invoice alone, so the coupon is not wasted', () => {
    expect(referralRewardAction(pending, invoice({ total: 0 }))).toBe('skip')
  })
  it('waits for the next invoice when this one is already finalised', () => {
    expect(referralRewardAction(pending, invoice({ status: 'open' }))).toBe('skip')
    expect(referralRewardAction(pending, invoice({ status: 'paid' }))).toBe('skip')
  })
  it('records a coupon Checkout already put on a finalised invoice', () => {
    const reward = { status: 'pending', stripe_coupon_id: 'co_ref' }
    expect(referralRewardAction(reward, invoice({ status: 'paid', discounts: [{ id: 'di_1', source: { coupon: 'co_ref' } }] }))).toBe('record')
  })
  it('does not attach a coupon made for one Checkout to a paid invoice that lacks it', () => {
    expect(referralRewardAction({ status: 'pending', stripe_coupon_id: 'co_ref' }, invoice({ status: 'paid' }))).toBe('skip')
  })
  it('never touches a reward already applied', () => {
    expect(referralRewardAction({ status: 'applied', stripe_coupon_id: 'co_ref' }, invoice())).toBe('skip')
  })
})

describe('sharesAnOwner', () => {
  it('catches someone referring their own second clinic', () => {
    expect(sharesAnOwner(['u1', 'u2'], ['u3', 'u2'])).toBe(true)
  })
  it('lets two clinics with different owners through', () => {
    expect(sharesAnOwner(['u1'], ['u2'])).toBe(false)
  })
  it('does not treat two owners without a login as the same person', () => {
    expect(sharesAnOwner([null], [null])).toBe(false)
  })
})
