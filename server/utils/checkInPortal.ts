import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { deriveCheckInCodeKey } from '~/server/utils/checkInCode'
import { serverSecretKey } from '~/server/utils/serviceSupabase'

/** The key the app's check-in QR codes are signed with, or null on a deployment with no secret key. */
export function checkInCodeKey(): Buffer | null {
  const secret = serverSecretKey()
  return secret ? deriveCheckInCodeKey(secret) : null
}

// The location a check-in portal link belongs to, or 404: an unknown token,
// a portal turned off (its row deleted), or a location since archived.
export async function checkInPortalClinic(service: SupabaseClient<Database>, token: string | undefined) {
  if (!token || !/^[0-9a-f]{32,64}$/.test(token)) throw createError({ statusCode: 404, statusMessage: 'This check-in portal is switched off.' })
  const { data } = await service
    .from('check_in_portals')
    .select('clinic_id, account_id, identify_by, language, welcome_message, success_message, not_found_message, clinics(name, timezone, archived_at)')
    .eq('token', token)
    .maybeSingle()
  const clinic = data?.clinics
  if (!data || !clinic || clinic.archived_at) throw createError({ statusCode: 404, statusMessage: 'This check-in portal is switched off.' })
  return {
    id: data.clinic_id,
    accountId: data.account_id,
    name: clinic.name,
    timezone: clinic.timezone,
    identifyBy: data.identify_by === 'national_id' ? ('national_id' as const) : ('birth_date' as const),
    language: data.language,
    messages: { welcome: data.welcome_message, success: data.success_message, notFound: data.not_found_message },
  }
}

/** The columns Settings reads, for checkInPortalSettings. */
export const PORTAL_SETTINGS_SELECT = 'token, identify_by, language, welcome_message, success_message, not_found_message'

type PortalSettingsRow = { token: string; identify_by: string; language: string; welcome_message: string | null; success_message: string | null; not_found_message: string | null }

/** What the Settings section reads and gets back after each change: a null token while the portal is off. */
export function checkInPortalSettings(row: PortalSettingsRow | null) {
  return {
    token: row?.token ?? null,
    identifyBy: row?.identify_by ?? 'birth_date',
    language: row?.language ?? 'es',
    welcomeMessage: row?.welcome_message ?? '',
    successMessage: row?.success_message ?? '',
    notFoundMessage: row?.not_found_message ?? '',
  }
}

/** A message as Settings saves it: trimmed, at most 300 characters, and blank as null (the standard wording). */
export function portalMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length > 300) throw createError({ statusCode: 400, statusMessage: 'A message can be at most 300 characters' })
  return text || null
}

/** A new portal link's secret: 32 random bytes, hex. */
export function newCheckInPortalToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
