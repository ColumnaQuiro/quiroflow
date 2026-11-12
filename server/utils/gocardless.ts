import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// GoCardless, reached as a PARTNER: each clinic connects its own GoCardless
// account by OAuth and we act on it with the token that hands us. Nothing
// here is the platform's own money.
//
// A thin fetch wrapper rather than the gocardless-nodejs SDK. The API is plain
// JSON over HTTPS with a version header, the handful of calls we make fit in
// a page, and a top-level SDK import in server/utils would load on every cold
// start of every route (CLAUDE.md, "A top-level import in server/utils").
//
// Design and the reasons behind it: docs/gocardless-integration-plan.md.

const API_VERSION = '2015-07-06'

export function gocardlessHosts() {
  const config = useRuntimeConfig()
  const live = config.gocardlessEnvironment === 'live'
  return {
    environment: (live ? 'live' : 'sandbox') as 'live' | 'sandbox',
    api: (config.gocardlessApiBaseUrl as string) || (live ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com'),
    connect: (config.gocardlessConnectBaseUrl as string) || (live ? 'https://connect.gocardless.com' : 'https://connect-sandbox.gocardless.com'),
  }
}

/** True when this deployment has a GoCardless partner app to connect clinics with. */
export function gocardlessConfigured(): boolean {
  const config = useRuntimeConfig()
  return Boolean(config.gocardlessClientId && config.gocardlessClientSecret)
}

export class GoCardlessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** GoCardless's own error type and reasons, e.g. invalid_api_usage / access_token_revoked. */
    readonly type: string | null,
    readonly reasons: string[],
  ) {
    super(message)
  }

  /** The clinic revoked us from its own dashboard, or the token is otherwise dead. */
  get tokenGone() {
    return this.status === 401 || this.reasons.some((r) => r.startsWith('access_token_'))
  }
}

export interface GoCardlessRequest {
  <T = any>(method: 'GET' | 'POST' | 'PUT', path: string, options?: { query?: Record<string, string | number | undefined>; body?: unknown; idempotencyKey?: string }): Promise<T>
}

export function gocardlessRequester(accessToken: string): GoCardlessRequest {
  const { api } = gocardlessHosts()
  return async (method, path, options = {}) => {
    const url = new URL(`${api}${path}`)
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'GoCardless-Version': API_VERSION,
      Accept: 'application/json',
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    // Creating something twice because a request timed out after GoCardless
    // had acted is how a patient gets two subscriptions. Every POST that
    // creates carries a key derived from what it is for.
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    const response = await fetch(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
    const text = await response.text()
    const json = text ? JSON.parse(text) : {}
    if (!response.ok) {
      const error = json?.error ?? {}
      // A create replayed under the same key answers 409 with the id of what
      // the first attempt made; the caller asked for that thing, so fetch it.
      const conflicting = (error.errors ?? []).find((e: any) => e?.reason === 'idempotent_creation_conflict')?.links?.conflicting_resource_id
      if (response.status === 409 && conflicting && method === 'POST') {
        const resource = path.split('/').filter(Boolean)[0]!
        return (await gocardlessRequester(accessToken)('GET', `/${resource}/${conflicting}`)) as any
      }
      throw new GoCardlessError(
        error.message ?? `GoCardless answered ${response.status}`,
        response.status,
        error.type ?? null,
        (error.errors ?? []).map((e: any) => e?.reason).filter(Boolean),
      )
    }
    return json
  }
}

/** Every page of a list endpoint, following meta.cursors.after. */
export async function gocardlessListAll<T>(request: GoCardlessRequest, path: string, key: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const out: T[] = []
  let after: string | undefined
  for (let page = 0; page < 100; page++) {
    const json = await request('GET', path, { query: { ...query, limit: 500, after } })
    out.push(...((json?.[key] as T[]) ?? []))
    after = json?.meta?.cursors?.after ?? undefined
    if (!after) break
  }
  return out
}

/**
 * The clinic's GoCardless, for a server route. Null when it has not
 * connected. `supabase` must be the service role: the token is in
 * account_secrets, which nobody else can read.
 */
export async function gocardlessForAccount(supabase: SupabaseClient<Database>, accountId: string) {
  const token = await getAccountSecret(supabase, accountId, 'gocardless_access_token')
  if (!token) return null
  return gocardlessRequester(token)
}

/**
 * The webhook signature: HMAC-SHA256 of the raw body under the partner app's
 * webhook secret, hex, in the Webhook-Signature header. Compared in constant
 * time, and over the raw bytes -- a re-serialised body would not match.
 */
export function gocardlessSignatureValid(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------
// The resources we read. Only the fields used here.
// ---------------------------------------------------------------------

export interface GcCustomer {
  id: string
  email: string | null
  given_name: string | null
  family_name: string | null
  company_name: string | null
  phone_number: string | null
}

export interface GcCustomerBankAccount {
  id: string
  account_number_ending: string | null
  bank_name: string | null
}

export interface GcMandate {
  id: string
  status: string
  scheme: string | null
  reference: string | null
  next_possible_charge_date: string | null
  created_at: string
  links: { customer: string; customer_bank_account: string; creditor: string; new_mandate?: string }
}

export interface GcSubscription {
  id: string
  status: string
  amount: number
  currency: string
  name: string | null
  interval_unit: 'weekly' | 'monthly' | 'yearly'
  interval: number
  day_of_month: number | null
  start_date: string | null
  end_date: string | null
  upcoming_payments?: { charge_date: string; amount: number }[]
  links: { mandate: string }
  metadata?: Record<string, string>
}

export interface GcPayment {
  id: string
  status: string
  amount: number
  currency: string
  charge_date: string
  links: { mandate: string; subscription?: string; creditor: string }
}

export interface GcEvent {
  id: string
  created_at: string
  resource_type: string
  action: string
  details?: { cause?: string; description?: string; will_attempt_retry?: boolean; origin?: string }
  links: Record<string, string | undefined>
}

/** A QuiroFlow billing period in GoCardless's vocabulary. */
export function gocardlessInterval(interval: string | null | undefined, count: number | null | undefined): { interval_unit: 'weekly' | 'monthly' | 'yearly'; interval: number } {
  const unit = interval === 'week' ? 'weekly' : interval === 'year' ? 'yearly' : 'monthly'
  return { interval_unit: unit, interval: Math.max(1, count ?? 1) }
}

/**
 * Forgets the clinic's connection: the token and the organisation. Called on
 * disconnect from Settings, on GoCardless's organisations/disconnected event,
 * and when a call finds the token revoked from the clinic's own dashboard.
 *
 * The mandate and schedule rows stay. They record what was matched and what
 * QuiroFlow set up, and reconnecting the same organisation picks them up
 * again; nothing about them is wrong just because access lapsed.
 */
export async function forgetGoCardlessConnection(supabase: SupabaseClient<Database>, accountId: string) {
  await deleteAccountSecret(supabase, accountId, 'gocardless_access_token')
  await supabase
    .from('accounts')
    .update({ gocardless_organisation_id: null, gocardless_environment: null, gocardless_verification_status: null, gocardless_connected_at: null })
    .eq('id', accountId)
}
