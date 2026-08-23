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

export async function requireTeamMember(event: H3Event) {
  const supabase = await resolveSupabaseClient(event)
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, account_id, is_owner, role_id')
    .maybeSingle()

  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  return { supabase, teamMember }
}

export async function requirePermission(event: H3Event, permKey: string) {
  const { supabase, teamMember } = await requireTeamMember(event)

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
