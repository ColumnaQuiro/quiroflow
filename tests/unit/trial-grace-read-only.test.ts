import { describe, it, expect } from 'vitest'
import {
  TRIAL_GRACE_DAYS,
  daysUntil,
  graceBackdate,
  graceCatchUpCents,
  isReadOnlyAccount,
  readOnlyAllowsRequest,
  trialGraceEndsAt,
  trialPhase,
} from '../../utils/billing'
import { isAccountReadOnlyResponse } from '../../utils/supabaseFailures'
import { FOUNDER_NOTICE, dueTrialNotice, founderAlertDue, trialNoticeEmail } from '../../server/utils/trialNotices'

// The end of a free trial with no card: a grace week with everything working,
// then read-only -- never locked out (20261120184541_trial_grace_then_read_only).

const DAY = 86_400_000
const now = new Date('2026-11-20T10:00:00Z')
const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString()

describe('trialPhase', () => {
  const row = (over: Partial<Parameters<typeof trialPhase>[0] & object> = {}) => ({ status: 'trialing', trial_ends_at: at(5), comped: false, has_stripe_subscription: false, ...over })

  it('is the trial while days are left, and the grace week once it has ended', () => {
    expect(trialPhase(row(), now)).toBe('trial')
    expect(trialPhase(row({ trial_ends_at: at(-2) }), now)).toBe('grace')
  })

  it('is nothing for a comped account, a card on file, or a row that is not trialing', () => {
    expect(trialPhase(row({ trial_ends_at: at(-2), comped: true }), now)).toBeNull()
    expect(trialPhase(row({ trial_ends_at: at(-2), has_stripe_subscription: true }), now)).toBeNull()
    expect(trialPhase(row({ status: 'active' }), now)).toBeNull()
    expect(trialPhase(row({ trial_ends_at: null }), now)).toBeNull()
  })

  it('turns read-only a grace week after the trial ends', () => {
    expect(trialGraceEndsAt(at(0)).toISOString()).toBe(at(TRIAL_GRACE_DAYS))
    expect(daysUntil(trialGraceEndsAt(at(-2)), now)).toBe(TRIAL_GRACE_DAYS - 2)
  })
})

describe('read-only', () => {
  it('is locked or cancelled, never comped', () => {
    expect(isReadOnlyAccount('locked', false)).toBe(true)
    expect(isReadOnlyAccount('canceled', false)).toBe(true)
    expect(isReadOnlyAccount('locked', true)).toBe(false)
    expect(isReadOnlyAccount('trialing', false)).toBe(false)
    expect(isReadOnlyAccount('past_due', false)).toBe(false)
  })

  it('lets reads, exports and talking to people through, and nothing else', () => {
    expect(readOnlyAllowsRequest('GET', '/api/patients/abc')).toBe(true)
    expect(readOnlyAllowsRequest('HEAD', '/api/anything')).toBe(true)
    expect(readOnlyAllowsRequest('POST', '/api/patients/abc/gdpr-export')).toBe(true)
    expect(readOnlyAllowsRequest('POST', '/api/patient-invoices/pdf-link')).toBe(true)
    expect(readOnlyAllowsRequest('POST', '/api/support/message')).toBe(true)
    expect(readOnlyAllowsRequest('POST', '/api/team-messages/send')).toBe(true)
    expect(readOnlyAllowsRequest('POST', '/api/appointments/prepaid-visit')).toBe(false)
    expect(readOnlyAllowsRequest('DELETE', '/api/patients/abc')).toBe(false)
    expect(readOnlyAllowsRequest('post', '/api/patients/abc/gdpr-export-something')).toBe(false)
  })

  it('recognises the refusal from the database and from a server route, and nothing else', () => {
    expect(isAccountReadOnlyResponse(423, JSON.stringify({ code: 'PT423', message: 'Tu cuenta…', details: 'account_read_only' }))).toBe(true)
    expect(isAccountReadOnlyResponse(423, JSON.stringify({ statusCode: 423, data: { reason: 'account_read_only' } }))).toBe(true)
    expect(isAccountReadOnlyResponse(402, JSON.stringify({ code: 'PT402', details: 'seats' }))).toBe(false)
    expect(isAccountReadOnlyResponse(423, '{}')).toBe(false)
  })
})

describe('a card added in the grace week pays from the day the trial ended', () => {
  const grace = { status: 'trialing', trial_ends_at: at(-4), comped: false, stripe_subscription_id: null }

  it('anchors the billing cycle one period after the trial ended', () => {
    const monthly = graceBackdate(grace, 'monthly', now)!
    expect(new Date(monthly.periodStart * 1000).toISOString()).toBe(at(-4))
    expect(new Date(monthly.anchor * 1000).toISOString()).toBe('2026-12-16T10:00:00.000Z')
    const annual = graceBackdate(grace, 'annual', now)!
    expect(new Date(annual.anchor * 1000).toISOString()).toBe('2027-11-16T10:00:00.000Z')
  })

  it('charges the days already used as a one-off, so the two parts make one full period', () => {
    const b = graceBackdate(grace, 'monthly', now)!
    const catchUp = graceCatchUpCents(4500, b, now)
    // Stripe prorates now -> anchor by the same rule; together, the full price.
    const rest = Math.round((4500 * (b.anchor - now.getTime() / 1000)) / (b.anchor - b.periodStart))
    expect(catchUp).toBe(Math.round((4500 * 4) / 30))
    expect(catchUp + rest).toBe(4500)
  })

  it('keeps month ends inside the month', () => {
    const b = graceBackdate({ ...grace, trial_ends_at: '2027-01-31T09:00:00Z' }, 'monthly', new Date('2027-02-02T09:00:00Z'))!
    expect(new Date(b.anchor * 1000).toISOString()).toBe('2027-02-28T09:00:00.000Z')
  })

  it('makes nothing up inside the trial, past the grace week, for comped, or with a card', () => {
    expect(graceBackdate({ ...grace, trial_ends_at: at(3) }, 'monthly', now)).toBeNull()
    expect(graceBackdate({ ...grace, trial_ends_at: at(-(TRIAL_GRACE_DAYS + 2)) }, 'monthly', now)).toBeNull()
    expect(graceBackdate({ ...grace, status: 'locked' }, 'monthly', now)).toBeNull()
    expect(graceBackdate({ ...grace, comped: true }, 'monthly', now)).toBeNull()
    expect(graceBackdate({ ...grace, stripe_subscription_id: 'sub_1' }, 'monthly', now)).toBeNull()
  })
})

describe('trial notices', () => {
  it('sends each one inside its window, once', () => {
    expect(dueTrialNotice(at(10), [], now)).toBeNull()
    expect(dueTrialNotice(at(6.5), [], now)).toBe('before_7')
    expect(dueTrialNotice(at(2.5), [], now)).toBe('before_3')
    expect(dueTrialNotice(at(0.5), [], now)).toBe('before_1')
    expect(dueTrialNotice(at(-1), [], now)).toBe('ended')
    expect(dueTrialNotice(at(-4), [], now)).toBe('grace_3')
    expect(dueTrialNotice(at(-6.5), [], now)).toBe('grace_last')
    expect(dueTrialNotice(at(-8), [], now)).toBeNull()
    expect(dueTrialNotice(at(-1), ['ended'], now)).toBeNull()
  })

  it('catches up a missed day with the notice for today, not a backlog', () => {
    expect(dueTrialNotice(at(2.5), ['before_7'], now)).toBe('before_3')
    expect(dueTrialNotice(at(2.5), [], now)).toBe('before_3')
  })

  it('tells us three days before, once, and not after the grace week', () => {
    expect(founderAlertDue(at(5), [], now)).toBe(false)
    expect(founderAlertDue(at(2), [], now)).toBe(true)
    expect(founderAlertDue(at(-3), [], now)).toBe(true)
    expect(founderAlertDue(at(2), [FOUNDER_NOTICE], now)).toBe(false)
    expect(founderAlertDue(at(-8), [], now)).toBe(false)
  })

  it('says, once the trial has ended, when it turns read-only and that billing counts from the end', () => {
    const { subject, html } = trialNoticeEmail('ended', { language: 'es', ownerName: 'Ana Pérez', clinicName: 'Clínica <Demo>', trialEndsAt: '2026-11-18T10:00:00Z' })
    expect(subject).toBe('Tu prueba de QuiroFlow ha terminado')
    expect(html).toContain('Hola Ana,')
    expect(html).toContain('Clínica &lt;Demo&gt;')
    expect(html).toContain('25 de noviembre')
    expect(html).toContain('El pago cuenta desde el 18 de noviembre')
    expect(html).toContain('https://app.quiroflow.com/subscription')
  })
})
