import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The platform side of "QuiroFlow sends for you" (Settings > VeriFactu).
//
// The platform is an ACCOUNT (verifactu_platform), not configuration: its
// uploaded certificate is the one that sends for delegated clinics, its
// clinic's NIF and legal name are what a clinic names at the AEAT when it
// grants the apoderamiento, and its owners accept the delegations. Columnaquiro
// S.L. already sends for itself with exactly that certificate, so nothing new
// has to be uploaded or configured for it to send for others.

export type VerifactuSender = 'own_certificate' | 'apoderamiento' | 'colaboracion_social'

export function isDelegated(sender: string | null | undefined): sender is 'apoderamiento' | 'colaboracion_social' {
  return sender === 'apoderamiento' || sender === 'colaboracion_social'
}

export async function verifactuPlatformAccountId(admin: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await admin.from('verifactu_platform').select('account_id').maybeSingle()
  return data?.account_id ?? null
}

/** Who a clinic authorises: the platform company, as the AEAT knows it. */
export async function verifactuPlatformIdentity(admin: SupabaseClient<Database>) {
  const accountId = await verifactuPlatformAccountId(admin)
  if (!accountId) return null
  const { data: clinic } = await admin
    .from('clinics')
    .select('tax_id, legal_name, name')
    .eq('account_id', accountId)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  return { accountId, nif: clinic?.tax_id ?? null, legalName: clinic?.legal_name || clinic?.name || null }
}

/**
 * An owner of the platform account -- the people who accept a clinic's
 * authorisation once it has been accepted at the AEAT. There is no separate
 * "QuiroFlow staff" role; this is it.
 */
export async function requireVerifactuPlatformOwner(event: H3Event) {
  const { supabase, teamMember } = await requireOwner(event)
  const admin = serverSupabaseServiceRole<Database>(event)
  const platformAccountId = await verifactuPlatformAccountId(admin)
  if (!platformAccountId || teamMember.account_id !== platformAccountId) {
    throw createError({ statusCode: 403, statusMessage: 'Only QuiroFlow can do this' })
  }
  return { supabase, admin, teamMember }
}
