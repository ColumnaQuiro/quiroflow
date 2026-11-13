import { describe, it, expect } from 'vitest'
import { deferralRetryAt, emailLimitsFrom, isBulkEmailRule, nextBudgetDay, SHARE_RETRY_MINUTES } from '../../server/utils/emailBudget'
import { brevoRefusedOnQuota, resendRefusedOnQuota } from '../../server/utils/resend'

// The pure halves of the daily email budget (server/utils/emailBudget.ts):
// what the day allows, when it resets, which refusals mean "come back
// tomorrow", and which emails are a campaign that may wait.

describe('emailLimitsFrom', () => {
  const keys = { resendApiKey: 're_x', brevoApiKey: 'xkeysib' }

  it('defaults to the free plans, with a quarter kept back for transactional email', () => {
    expect(emailLimitsFrom(keys)).toEqual({ resend: 100, brevo: 300, reserve: 100 })
  })

  it('counts no Brevo budget without a Brevo key, and keeps a quarter of what is left', () => {
    expect(emailLimitsFrom({ resendApiKey: 're_x' })).toEqual({ resend: 100, brevo: 0, reserve: 25 })
  })

  it('reads "0" as no daily limit (every paid Resend plan), and then keeps nothing back', () => {
    expect(emailLimitsFrom({ ...keys, emailDailyLimitResend: '0' })).toEqual({ resend: null, brevo: 300, reserve: 0 })
  })

  it('takes a number as that many a day', () => {
    expect(emailLimitsFrom({ ...keys, emailDailyLimitResend: '1600', emailDailyLimitBrevo: '300' })).toEqual({ resend: 1600, brevo: 300, reserve: 475 })
  })

  it('takes an explicit reserve as given, zero included', () => {
    expect(emailLimitsFrom({ ...keys, emailTransactionalReserve: '40' }).reserve).toBe(40)
    expect(emailLimitsFrom({ ...keys, emailTransactionalReserve: '0' }).reserve).toBe(0)
  })

  it('has no budget at all with no provider configured', () => {
    expect(emailLimitsFrom({})).toEqual({ resend: 0, brevo: 0, reserve: 0 })
  })
})

describe('when a deferred send is tried again', () => {
  it('resets at the next midnight UTC, as Resend does', () => {
    expect(nextBudgetDay(new Date('2026-11-13T06:21:00Z')).toISOString()).toBe('2026-11-14T00:00:00.000Z')
    // A minute before midnight is still today.
    expect(nextBudgetDay(new Date('2026-11-13T23:59:00Z')).toISOString()).toBe('2026-11-14T00:00:00.000Z')
    // Across a month end.
    expect(nextBudgetDay(new Date('2026-11-30T12:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('waits for tomorrow when the budget is spent or the providers refused', () => {
    const now = new Date('2026-11-13T10:00:00Z')
    expect(deferralRetryAt('full', now).toISOString()).toBe('2026-11-14T00:00:00.000Z')
    expect(deferralRetryAt('quota', now).toISOString()).toBe('2026-11-14T00:00:00.000Z')
  })

  it('asks again shortly when it is only waiting for another clinic to have its turn', () => {
    const now = new Date('2026-11-13T10:00:00Z')
    expect(deferralRetryAt('share', now).getTime() - now.getTime()).toBe(SHARE_RETRY_MINUTES * 60_000)
  })
})

describe('refusals on quota', () => {
  it("takes Resend's daily and monthly quota errors", () => {
    expect(resendRefusedOnQuota(429, 'daily_quota_exceeded', 'You have reached your daily email sending quota.')).toBe(true)
    expect(resendRefusedOnQuota(429, 'monthly_quota_exceeded', 'x')).toBe(true)
  })

  it("does not take Resend's per-second rate limit, which is over in a second", () => {
    expect(resendRefusedOnQuota(429, 'rate_limit_exceeded', 'Too many requests. You can only make 10 requests per second.')).toBe(false)
  })

  it('does not take any other Resend refusal', () => {
    expect(resendRefusedOnQuota(403, 'validation_error', 'The quiroflow.com domain is not verified.')).toBe(false)
  })

  it('takes a Brevo refusal about credits or limits, by status or by code', () => {
    expect(brevoRefusedOnQuota(400, 'not_enough_credits', 'Not enough credits')).toBe(true)
    expect(brevoRefusedOnQuota(402, '', 'Payment required')).toBe(true)
    expect(brevoRefusedOnQuota(429, '', 'Too many requests')).toBe(true)
    expect(brevoRefusedOnQuota(400, 'permission_denied', 'You have reached your daily sending limit')).toBe(true)
  })

  it('does not take a Brevo refusal about the message itself', () => {
    expect(brevoRefusedOnQuota(400, 'invalid_parameter', 'sender is not valid')).toBe(false)
  })
})

describe('isBulkEmailRule', () => {
  it('treats a marketing rule as a campaign, whatever starts it', () => {
    expect(isBulkEmailRule({ is_marketing: true, trigger_event: 'patient.birthday' })).toBe(true)
  })

  it('treats a rule aimed at a segment or a list as a campaign', () => {
    expect(isBulkEmailRule({ is_marketing: false, trigger_event: 'segment' })).toBe(true)
    expect(isBulkEmailRule({ is_marketing: false, trigger_event: 'audience.entered' })).toBe(true)
  })

  it("sends everything about a person's own visit at once", () => {
    expect(isBulkEmailRule({ is_marketing: false, trigger_event: 'appointment.booked' })).toBe(false)
    expect(isBulkEmailRule({ trigger_event: 'lead.created' })).toBe(false)
  })
})
