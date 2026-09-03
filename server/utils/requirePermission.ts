import { createClient } from '@supabase/supabase-js'
import { serverSupabaseClient } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

// The web app authenticates via a cookie (handled by serverSupabaseClient).
// The mobile app has no cookie -- Capacitor's WebView origin can't reliably
// carry it cross-origin to this API -- so it sends the user's own Supabase
// access token as a bearer header instead. Building the client with that
// token as its Authorization header makes every query run under the same
// user's RLS as the cookie path would, just via a different transport.
async function resolveSupabaseClient(event: H3Event) {
  const auth = getHeader(event, 'authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return serverSupabaseClient<Database>(event)

  const config = useRuntimeConfig()
  return createClient<Database>(config.public.supabase.url, config.public.supabase.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
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
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  return { supabase, teamMember }
}

// Defense-in-depth behind the full-screen lock every staff page already
// shows once an account is 'locked'/'canceled' (see layouts/default.vue) --
// this is what stops the underlying API calls too, in case something
// reaches them without going through that UI (a stale tab, a direct call).
// Not applied to requireTeamMember itself: a few routes call that directly
// for internal/system work (webhooks, cron-fired automations) that
// shouldn't stop just because a clinic hasn't paid.
export async function requireActiveAccount(event: H3Event) {
  const { supabase, teamMember } = await requireTeamMember(event)

  const { data: subscription } = await supabase.from('subscriptions').select('status').eq('account_id', teamMember.account_id).maybeSingle()

  // No row at all is treated as not-locked rather than as an error -- fail
  // open, not closed, so a gap in backfill never itself locks someone out.
  if (subscription && (subscription.status === 'locked' || subscription.status === 'canceled')) {
    throw createError({ statusCode: 402, statusMessage: 'This account is locked pending payment' })
  }

  return { supabase, teamMember }
}

export async function requirePermission(event: H3Event, permKey: string) {
  const { supabase, teamMember } = await requireActiveAccount(event)

  if (!teamMember.is_owner) {
    const { data: allowed } = await supabase.rpc('has_permission', {
      target_account_id: teamMember.account_id,
      perm_key: permKey,
    })
    if (!allowed) {
      throw createError({ statusCode: 403, statusMessage: `Missing permission: ${permKey}` })
    }
  }

  return { supabase, teamMember }
}
