import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { isDelegated, verifactuPlatformAccountId, type VerifactuSender } from '~/server/utils/verifactuPlatform'

// Who sends this clinic's records: its own certificate, or QuiroFlow under
// an apoderamiento (IZ860) or a colaboración social with a signed document.
//
// Choosing a QuiroFlow route files a request; nothing goes out with the
// platform certificate until QuiroFlow accepts it (verifactu_delegations
// .accepted_at), because the AEAT refuses every submission until it has the
// authorisation. Switching route starts that over: an IZ860 accepted at the
// AEAT says nothing about a colaboración social document, or the reverse.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireOwner(event)
  const body = await readBody<{ sender?: string }>(event)
  const sender = body?.sender as VerifactuSender | undefined
  if (sender !== 'own_certificate' && !isDelegated(sender)) {
    throw createError({ statusCode: 400, statusMessage: 'sender must be own_certificate, apoderamiento or colaboracion_social' })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const accountId = teamMember.account_id

  if (isDelegated(sender)) {
    const platformAccountId = await verifactuPlatformAccountId(admin)
    if (!platformAccountId) {
      throw createError({ statusCode: 409, statusMessage: 'QuiroFlow cannot send for clinics in this environment' })
    }
    if (platformAccountId === accountId) {
      throw createError({ statusCode: 400, statusMessage: 'This is QuiroFlow’s own account: it sends with its own certificate' })
    }

    const { data: existing } = await admin.from('verifactu_delegations').select('route').eq('account_id', accountId).maybeSingle()
    if (existing?.route !== sender) {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await admin.from('verifactu_delegations').upsert(
        {
          account_id: accountId,
          route: sender,
          requested_at: new Date().toISOString(),
          requested_by: user?.id ?? null,
          signed_document_base64: null,
          signed_document_name: null,
          signed_document_uploaded_at: null,
          accepted_at: null,
          accepted_by: null,
        },
        { onConflict: 'account_id' },
      )
      if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    }
  } else {
    // Back to its own certificate: the request is withdrawn. The AEAT side
    // (revoking the apoderamiento) is the clinic's to do there.
    const { error } = await admin.from('verifactu_delegations').delete().eq('account_id', accountId)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const { error } = await admin.from('accounts').update({ verifactu_sender: sender }).eq('id', accountId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true }
})
