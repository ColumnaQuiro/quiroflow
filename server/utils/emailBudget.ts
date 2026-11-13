import { AsyncLocalStorage } from 'node:async_hooks'
import { serviceSupabase } from './serviceSupabase'

// The daily email budget: how many emails QuiroFlow may still send today, and
// who gets them.
//
// Resend's free plan allows 100 a day and Brevo's 300; past that each one
// refuses, and a refused email used to be a lost one. Two kinds of email share
// that budget and they are not equally urgent:
//
//   transactional  confirmations, reminders, invoices, invites, anything a
//                  person sends from the app. Sent at once, always -- a
//                  reminder that goes out tomorrow is no reminder.
//   bulk           a campaign: the emails of a marketing automation, or of one
//                  aimed at a segment or a list. Each takes a slot before it
//                  is sent, and when there is none the run waits for
//                  tomorrow's budget instead of failing (automationEngine,
//                  waiting_for = 'email_quota').
//
// A campaign never takes the reserve kept for transactional email, so a
// Monday's 900-patient newsletter can no longer stop the day's reminders, and
// a clinic's campaign only takes its fair share while another clinic's waits
// (claim_bulk_email, 20261113062158_email_send_budget.sql).
//
// Which kind a send is, is said by the code that walks the automation, not by
// every function between it and deliverEmail: withEmailScope() wraps a step,
// and deliverEmail reads the scope back. Anything sent outside a scope is
// transactional and behaves exactly as it did before the budget existed.
//
// Everything that touches the database here fails OPEN. A budget that cannot
// be read must not stop email: the providers' own refusals are still there
// underneath, and those are what this exists to stay clear of, not replace.

export type EmailKind = 'transactional' | 'bulk'
export type EmailProvider = 'resend' | 'brevo'

/** Why a send was put off rather than made. */
export type DeferralReason = 'full' | 'share' | 'quota'

interface EmailScope {
  kind: EmailKind
  accountId: string
}

const scope = new AsyncLocalStorage<EmailScope>()

/**
 * Runs `fn` with every email it sends counted as `kind`, for `accountId`.
 * Inside a scope a send that cannot be made for lack of budget throws
 * EmailDeferred instead of failing -- the caller has somewhere to park it.
 */
export function withEmailScope<T>(s: EmailScope, fn: () => Promise<T>): Promise<T> {
  return scope.run(s, fn)
}

export function currentEmailScope(): EmailScope | null {
  return scope.getStore() ?? null
}

/**
 * A campaign rather than a message about the person's own visit: a marketing
 * rule, or one aimed at a segment or a list. Its emails take a slot of the
 * day's campaign budget and wait when there is none; everything else is sent
 * at once, out of the reserve kept for it.
 */
export function isBulkEmailRule(rule: { is_marketing?: boolean | null; trigger_event: string }): boolean {
  return Boolean(rule.is_marketing) || rule.trigger_event === 'segment' || rule.trigger_event === 'audience.entered'
}

/** Not sent, on purpose: there is no budget for it now. Says when to try again. */
export class EmailDeferred extends Error {
  constructor(
    readonly reason: DeferralReason,
    readonly retryAt: Date,
  ) {
    super(deferralMessage(reason, retryAt))
    this.name = 'EmailDeferred'
  }
}

function deferralMessage(reason: DeferralReason, retryAt: Date) {
  if (reason === 'share') return `Waiting its turn: other clinics' campaigns are sending today. Trying again at ${retryAt.toISOString()}.`
  if (reason === 'quota') return `The email providers refused on their daily quota. Waiting for it to reset at ${retryAt.toISOString()}.`
  return `Today's email budget for campaigns is spent. Waiting for it to reset at ${retryAt.toISOString()}.`
}

/** How long a clinic past its fair share waits before asking again. */
export const SHARE_RETRY_MINUTES = 30

/** When a deferred send should be tried again, at the earliest. */
export function deferralRetryAt(reason: DeferralReason, now = new Date()): Date {
  if (reason === 'share') return new Date(now.getTime() + SHARE_RETRY_MINUTES * 60_000)
  return nextBudgetDay(now)
}

/** The next 00:00 UTC: when Resend's daily quota, and this budget, reset. */
export function nextBudgetDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

const RESEND_FREE_DAILY = 100
const BREVO_FREE_DAILY = 300

export interface EmailLimits {
  /** null: no daily limit. */
  resend: number | null
  brevo: number | null
  reserve: number
}

/**
 * A configured daily limit: empty is the free plan's, "0" (or anything not a
 * positive number) is no daily limit at all.
 */
function parseLimit(raw: unknown, freePlan: number): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return freePlan
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The day's limits, from runtime config. Pure, for the tests. */
export function emailLimitsFrom(config: {
  resendApiKey?: unknown
  brevoApiKey?: unknown
  emailDailyLimitResend?: unknown
  emailDailyLimitBrevo?: unknown
  emailTransactionalReserve?: unknown
}): EmailLimits {
  const resend = config.resendApiKey ? parseLimit(config.emailDailyLimitResend, RESEND_FREE_DAILY) : 0
  const brevo = config.brevoApiKey ? parseLimit(config.emailDailyLimitBrevo, BREVO_FREE_DAILY) : 0
  const rawReserve = config.emailTransactionalReserve
  let reserve: number
  if (rawReserve !== undefined && rawReserve !== null && String(rawReserve).trim() !== '' && Number.isFinite(Number(rawReserve))) {
    reserve = Math.max(0, Math.floor(Number(rawReserve)))
  } else if (resend === null || brevo === null) {
    // No daily ceiling on one of them: nothing to keep back.
    reserve = 0
  } else {
    reserve = Math.ceil((resend + brevo) / 4)
  }
  return { resend, brevo, reserve }
}

export function emailLimits(): EmailLimits {
  return emailLimitsFrom(useRuntimeConfig() as Record<string, unknown>)
}

/**
 * Takes one slot of today's campaign budget for a clinic. 'ok' on any
 * failure to ask: see the note at the top on failing open.
 */
export async function claimBulkEmail(accountId: string): Promise<'ok' | 'share' | 'full'> {
  const service = serviceSupabase()
  if (!service) return 'ok'
  const limits = emailLimits()
  const { data, error } = await service.rpc('claim_bulk_email', {
    p_account_id: accountId,
    p_resend_limit: limits.resend,
    p_brevo_limit: limits.brevo,
    p_reserve: limits.reserve,
  })
  if (error) {
    console.error('[email-budget] could not claim a slot; sending anyway', error.message)
    return 'ok'
  }
  return data === 'share' || data === 'full' ? data : 'ok'
}

/** Gives back a slot for an email that did not go out. */
export async function releaseBulkEmail(accountId: string): Promise<void> {
  const service = serviceSupabase()
  if (!service) return
  const { error } = await service.rpc('release_bulk_email', { p_account_id: accountId })
  if (error) console.error('[email-budget] could not release a slot', error.message)
}

/** Counts one email that went out. */
export async function recordEmailSent(provider: EmailProvider, kind: EmailKind): Promise<void> {
  const service = serviceSupabase()
  if (!service) return
  const { error } = await service.rpc('record_email_sent', { p_provider: provider, p_kind: kind })
  if (error) console.error('[email-budget] could not count a send', error.message)
}

/** Resend's own count of today's sends, which includes what went out on the key from elsewhere. */
export async function observeResendDailyUsage(used: number): Promise<void> {
  const service = serviceSupabase()
  if (!service) return
  const { error } = await service.rpc('observe_resend_daily_usage', { p_used: used })
  if (error) console.error('[email-budget] could not record Resend usage', error.message)
}

/** A provider refused on quota: it is worth no more today than what it already took. */
export async function markProviderExhausted(provider: EmailProvider): Promise<void> {
  const service = serviceSupabase()
  if (!service) return
  const { error } = await service.rpc('mark_email_provider_exhausted', { p_provider: provider })
  if (error) console.error('[email-budget] could not mark a provider exhausted', error.message)
}
