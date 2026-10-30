import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// The location a check-in portal link belongs to, or 404: an unknown token,
// a portal turned off (its row deleted), or a location since archived.
export async function checkInPortalClinic(service: SupabaseClient<Database>, token: string | undefined) {
  if (!token || !/^[0-9a-f]{32,64}$/.test(token)) throw createError({ statusCode: 404, statusMessage: 'This check-in portal is switched off.' })
  const { data } = await service
    .from('check_in_portals')
    .select('clinic_id, account_id, clinics(name, timezone, archived_at)')
    .eq('token', token)
    .maybeSingle()
  const clinic = data?.clinics
  if (!data || !clinic || clinic.archived_at) throw createError({ statusCode: 404, statusMessage: 'This check-in portal is switched off.' })
  return { id: data.clinic_id, accountId: data.account_id, name: clinic.name, timezone: clinic.timezone }
}

/** A new portal link's secret: 32 random bytes, hex. */
export function newCheckInPortalToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
