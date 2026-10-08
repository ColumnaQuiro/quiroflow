import { createClient } from '@supabase/supabase-js'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

// Whose write it was, when the server makes it with the service role.
//
// The audit trigger (fn_audit_log, 20261008070424_audit_trail.sql) asks the
// database who is writing, and a service-role request carries no auth.uid().
// So everything a staff route wrote through serverSupabaseServiceRole was
// recorded as nobody -- 2,647 of 4,050 patient updates by Oct 2026.
//
// Once a guard in requirePermission.ts knows the caller, this puts a
// service-role client carrying an `x-audit-actor` header in the slot
// serverSupabaseServiceRole caches its client in, so every call after the
// guard -- in any of the ~50 routes that use it -- gets the header without
// any of them changing. The trigger believes the header only from a
// service_role request, which a browser cannot make.
//
// `_supabaseServiceRole` is @nuxtjs/supabase's own cache key, not an API it
// promises to keep. If an upgrade renames it, the check below notices that
// serverSupabaseServiceRole no longer returns this client and says so once,
// rather than the audit trail quietly going back to recording nobody.

let checked = false

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit) {
  // The module's client retries a failed fetch three times; this keeps that.
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init)
    } catch (error) {
      if (init?.signal?.aborted || attempt === 3) throw error
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
    }
  }
}

export function attachAuditActor(event: H3Event, teamMemberId: string) {
  const config = useRuntimeConfig(event) as unknown as {
    supabase?: { secretKey?: string; serviceKey?: string }
    public: { supabase: { url: string } }
  }
  const key = config.supabase?.secretKey || config.supabase?.serviceKey
  if (!key) return

  // Built on first use: most guarded routes never touch the service role,
  // and they should not pay for a client they do not use.
  let client: ReturnType<typeof createClient<Database>> | null = null
  Object.defineProperty(event.context, '_supabaseServiceRole', {
    configurable: true,
    enumerable: true,
    get() {
      client ??= createClient<Database>(config.public.supabase.url, key, {
        auth: { detectSessionInUrl: false, persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchWithRetry, headers: { 'x-audit-actor': teamMemberId } },
      })
      return client
    },
    set(value) {
      client = value
    },
  })

  if (!checked) {
    checked = true
    if (serverSupabaseServiceRole(event) !== event.context._supabaseServiceRole) {
      console.warn('[audit] serverSupabaseServiceRole no longer uses event.context._supabaseServiceRole; service-role writes will be audited as "server" instead of the team member.')
    }
  }
}
