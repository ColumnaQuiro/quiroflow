// Marks a clinic's authorisation accepted (or withdraws that). A statement
// about the AEAT made by a person: for an apoderamiento, that QuiroFlow has
// accepted IZ860 in the AEAT's office with its own certificate; for a
// colaboración social, that the signed document has been checked. From then
// on the sender uses the platform certificate for that clinic.
export default defineEventHandler(async (event) => {
  const { supabase, admin } = await requireVerifactuPlatformOwner(event)
  const accountId = getRouterParam(event, 'accountId')!
  const body = await readBody<{ accepted?: boolean }>(event)
  if (typeof body?.accepted !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'accepted must be true or false' })

  const { data: delegation } = await admin
    .from('verifactu_delegations')
    .select('route, signed_document_uploaded_at')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!delegation) throw createError({ statusCode: 404, statusMessage: 'That clinic has not asked QuiroFlow to send for it' })
  if (body.accepted && delegation.route === 'colaboracion_social' && !delegation.signed_document_uploaded_at) {
    throw createError({ statusCode: 409, statusMessage: 'The clinic has not uploaded the signed document yet' })
  }

  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await admin
    .from('verifactu_delegations')
    .update(body.accepted ? { accepted_at: new Date().toISOString(), accepted_by: user?.id ?? null } : { accepted_at: null, accepted_by: null })
    .eq('account_id', accountId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true }
})
