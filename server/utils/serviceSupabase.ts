import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// The service-role client and key, for code that has no H3 event to hand
// (serverSupabaseServiceRole needs one). Same key, same URL: the runtime
// config the Supabase module reads, NUXT_SUPABASE_SECRET_KEY.

/** The deployment's Supabase secret (service-role) key, or '' when unset. */
export function serverSecretKey(): string {
  const config = useRuntimeConfig() as unknown as { supabase?: { secretKey?: string; serviceKey?: string } }
  return config.supabase?.secretKey || config.supabase?.serviceKey || ''
}

let cached: SupabaseClient<Database> | null = null

/** A service-role client; null when this deployment has no secret key. */
export function serviceSupabase(): SupabaseClient<Database> | null {
  if (cached) return cached
  const key = serverSecretKey()
  if (!key) return null
  cached = createClient<Database>(useRuntimeConfig().public.supabase.url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  return cached
}
