import { createClient } from '@supabase/supabase-js'
import { serverSupabaseClient } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'
import { attachAuditActor } from '~/server/utils/auditActor'

// The web app authenticates via a cookie (handled by serverSupabaseClient).
// The mobile app has no cookie -- Capacitor's WebView origin can't reliably
// carry it cross-origin to this API -- so it sends the user's own Supabase
// access token as a bearer header instead. Building the client with that
// token as its Authorization header makes every query run under the same
// user's RLS as the cookie path would, just via a different transport.
function bearerToken(event: H3Event) {
  const auth = getHeader(event, 'authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

async function resolveSupabaseClient(event: H3Event) {
  const token = bearerToken(event)
  if (!token) return serverSupabaseClient<Database>(event)

  const config = useRuntimeConfig()
  return createClient<Database>(config.public.supabase.url, config.public.supabase.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Who is calling, checked against the project's signing key rather than by
// asking Supabase Auth. The project signs with ES256, so getClaims() verifies
// the token here, against a key set auth-js caches module-wide for ten
// minutes -- where getUser() was a round trip to the Auth server on every
// request, ~300 ms from the Netlify function before the route had read
// anything. Every staff route pays this, so it is most of why the Growth
// Inbox endpoints took over a second.
//
// It is the same check PostgREST makes on every query the route then runs,
// so it trusts the token no more than the database already does. The bearer
// token is passed explicitly: getClaims() reads a session from storage, and
// the mobile client has none -- only the header.
async function verifiedUserId(event: H3Event, supabase: Awaited<ReturnType<typeof resolveSupabaseClient>>) {
  const { data } = await supabase.auth.getClaims(bearerToken(event) || undefined)
  return data?.claims.sub ?? null
}

// For endpoints any signed-in user (patient or team_member) can call --
// e.g. registering a push-notification token -- not just staff.
export async function requireAuthedUser(event: H3Event) {
  const supabase = await resolveSupabaseClient(event)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  }
  return { supabase, user }
}

export async function requireTeamMember(event: H3Event) {
  const supabase = await resolveSupabaseClient(event)
  const userId = await verifiedUserId(event, supabase)
  if (!userId) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  // Filtering by user_id is required, not optional: the RLS policy on
  // team_members scopes SELECT by account membership ("can this caller see
  // any row for this account"), not by row ownership -- so an unfiltered
  // query returns every team_members row for the account, not just the
  // caller's own. .maybeSingle() throws once an account has a second team
  // member, which is exactly what broke every staff-authenticated route the
  // moment ColumnaQuiro's account passed one team member (confirmed live:
  // works with 1 row, 403s the instant a 2nd exists).
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, account_id, is_owner, role_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  attachAuditActor(event, teamMember.id)
  return { supabase, teamMember }
}

// Defense-in-depth behind the full-screen lock every staff page already
// shows once an account is 'locked'/'canceled' (see layouts/default.vue) --
// this is what stops the underlying API calls too, in case something
// reaches them without going through that UI (a stale tab, a direct call).
// Not applied to requireTeamMember itself: a few routes call that directly
// for internal/system work (webhooks, cron-fired automations) that
// shouldn't stop just because a clinic hasn't paid.
//
// The subscription is read in the same request as the team member, embedded
// through their account, rather than in a second one after it: every API
// route behind a permission comes through here, and each extra round trip to
// the database costs ~300 ms from the Netlify function. Both tables are
// readable by exactly the members of the account (is_account_member, plus
// the two-factor policy), so the embed sees what a direct read would.
export async function requireActiveAccount(event: H3Event) {
  const supabase = await resolveSupabaseClient(event)
  const userId = await verifiedUserId(event, supabase)
  if (!userId) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  // Filtered by user_id for the reason given in requireTeamMember. The
  // subscription carries what requireGrowth needs too, so the Growth routes
  // do not spend a round trip reading it again.
  const { data: row } = await supabase
    .from('team_members')
    .select('id, account_id, is_owner, role_id, accounts(subscriptions(status, plan_id, growth_addon, comped))')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!row) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  // No row at all is treated as not-locked rather than as an error -- fail
  // open, not closed, so a gap in backfill never itself locks someone out.
  // More than one also fails open, as the .maybeSingle() read this replaced
  // did: nothing says which of them is the account's.
  const { accounts, ...teamMember } = row
  const subscriptions = (accounts as { subscriptions: AccountSubscription[] } | null)?.subscriptions ?? []
  const subscription = subscriptions.length === 1 ? subscriptions[0]! : null
  if (subscription && (subscription.status === 'locked' || subscription.status === 'canceled')) {
    throw createError({ statusCode: 402, statusMessage: 'This account is locked pending payment' })
  }

  attachAuditActor(event, teamMember.id)
  return { supabase, teamMember, subscription }
}

export interface AccountSubscription {
  status: string
  plan_id: string | null
  growth_addon: boolean | null
  comped: boolean | null
}

async function checkPermissions(event: H3Event, permKeys: string[]) {
  const { supabase, teamMember, subscription } = await requireActiveAccount(event)

  if (!teamMember.is_owner) {
    // All at once rather than one after another; the first missing key in
    // the order given is still the one reported.
    const results = await Promise.all(
      permKeys.map((permKey) => supabase.rpc('has_permission', { target_account_id: teamMember.account_id, perm_key: permKey })),
    )
    const missing = permKeys.find((_, i) => !results[i]!.data)
    if (missing) {
      throw createError({ statusCode: 403, statusMessage: `Missing permission: ${missing}` })
    }
  }

  return { supabase, teamMember, subscription }
}

export async function requirePermission(event: H3Event, permKey: string) {
  return checkPermissions(event, [permKey])
}

/** Every one of the keys, for an endpoint that sits behind two permissions. */
export async function requireAllPermissions(event: H3Event, permKeys: string[]) {
  return checkPermissions(event, permKeys)
}

/**
 * For endpoints that exist only to serve a Settings page: requires
 * `settings_access` as well as the specific permission.
 *
 * utils/routePermissions.ts has always gated the Settings *routes* on both --
 * `can(settings_access) && can(billing_config)` and so on -- but the API
 * behind them checked the sub-permission alone. So a role with
 * `settings_access: false` and `billing_config: true` saw no Settings link,
 * was redirected away from /settings/payments, and could still POST
 * /api/stripe/secrets and overwrite the clinic's live Stripe key. Hiding a
 * page is not a guard; this is what makes the server agree with the router.
 *
 * Deliberately NOT applied to every route behind these permissions. Most of
 * them are day-to-day work that a non-settings role is supposed to do:
 * `communication_config` also gates campaigns, the growth inbox and the lead
 * pipeline (routePermissions gates /automations on that key *alone*, on
 * purpose), and `billing_config` also gates taking a card and scheduling a
 * payment from a patient's billing tab. Requiring settings_access there would
 * lock receptionists out of their own job. Only the endpoints whose sole
 * caller is a Settings page use this.
 */
export async function requireSettingsPermission(event: H3Event, permKey: string) {
  return checkPermissions(event, ['settings_access', permKey])
}

/**
 * For patient-scoped endpoints with no permission of their own: the caller
 * may act on this patient exactly when they may see the patient record. That
 * is `can_access_patient` -- patients_scope 'all', or 'own' and the patient is
 * theirs -- the same rule the patients RLS policy applies.
 *
 * Not found and not yours answer the same 404, so the route does not confirm
 * that a patient id exists to someone who cannot see it.
 */
export async function requirePatientAccess(event: H3Event, patientId: string | undefined) {
  if (!patientId) throw createError({ statusCode: 400, statusMessage: 'Missing patient id' })

  const { supabase, teamMember } = await requireActiveAccount(event)

  const { data: allowed } = await supabase.rpc('can_access_patient', {
    target_account_id: teamMember.account_id,
    target_patient_id: patientId,
  })
  if (!allowed) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }

  return { supabase, teamMember, patientId }
}
