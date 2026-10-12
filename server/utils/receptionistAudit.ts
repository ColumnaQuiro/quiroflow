import { createClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

// The service-role client the AI receptionist writes with when it books or
// moves a visit, or makes a patient from a lead: every row it touches is
// recorded in audit_logs as actor 'receptionist', "Recepcionista IA", with
// what changed (fn_audit_log; 20261012111552_audit_receptionist_actor.sql).
// Without the header the trail would call these writes 'server', like an
// import or a cron, and nobody could tell what the receptionist did.
//
// The header is believed only from a service_role request, which a browser
// cannot make -- the same rule as attachAuditActor's (auditActor.ts).
export function receptionistServiceClient(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as {
    supabase?: { secretKey?: string; serviceKey?: string }
    public: { supabase: { url: string } }
  }
  const key = config.supabase?.secretKey || config.supabase?.serviceKey
  if (!key) throw new Error('No service key: the receptionist cannot write to the calendar')
  return createClient<Database>(config.public.supabase.url, key, {
    auth: { detectSessionInUrl: false, persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-audit-actor': 'receptionist' } },
  })
}
