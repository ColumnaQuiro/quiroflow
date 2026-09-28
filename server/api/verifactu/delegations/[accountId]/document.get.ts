// The signed representation document, for QuiroFlow to check before
// accepting a colaboración social delegation.
export default defineEventHandler(async (event) => {
  const { admin } = await requireVerifactuPlatformOwner(event)
  const accountId = getRouterParam(event, 'accountId')!
  const { data } = await admin
    .from('verifactu_delegations')
    .select('signed_document_base64, signed_document_name')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data?.signed_document_base64) throw createError({ statusCode: 404, statusMessage: 'No signed document' })

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${(data.signed_document_name ?? 'documento.pdf').replace(/"/g, '')}"`)
  return Buffer.from(data.signed_document_base64, 'base64')
})
