import { verifactuPlatformIdentity } from '~/server/utils/verifactuPlatform'

// QuiroFlow's side of "QuiroFlow sends for you": every clinic that asked,
// which route, and whether its authorisation has been accepted. Only the
// platform account's owners see it (requireVerifactuPlatformOwner).
export default defineEventHandler(async (event) => {
  const { admin } = await requireVerifactuPlatformOwner(event)
  const platform = await verifactuPlatformIdentity(admin)

  const { data: rows, error } = await admin
    .from('verifactu_delegations')
    .select('account_id, route, requested_at, signed_document_name, signed_document_uploaded_at, accepted_at')
    .order('requested_at', { ascending: true })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const accountIds = (rows ?? []).map((r) => r.account_id)
  const { data: clinics } = accountIds.length
    ? await admin.from('clinics').select('account_id, name, legal_name, tax_id, created_at').in('account_id', accountIds).order('created_at')
    : { data: [] as { account_id: string; name: string; legal_name: string | null; tax_id: string | null }[] }
  // The first clinic of each account: the one whose NIF its records carry.
  const firstClinic = new Map<string, { name: string; legal_name: string | null; tax_id: string | null }>()
  for (const c of clinics ?? []) if (!firstClinic.has(c.account_id)) firstClinic.set(c.account_id, c)

  return {
    platform: platform ? { nif: platform.nif, legalName: platform.legalName } : null,
    delegations: (rows ?? []).map((r) => {
      const clinic = firstClinic.get(r.account_id)
      return {
        accountId: r.account_id,
        clinicName: clinic?.legal_name || clinic?.name || null,
        nif: clinic?.tax_id ?? null,
        route: r.route as 'apoderamiento' | 'colaboracion_social',
        requestedAt: r.requested_at,
        signedDocumentName: r.signed_document_name,
        signedDocumentUploadedAt: r.signed_document_uploaded_at,
        acceptedAt: r.accepted_at,
      }
    }),
  }
})
