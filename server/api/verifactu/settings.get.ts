import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { PASSPHRASE_SECRET_NAME } from '~/server/utils/verifactuCertificate'

// Everything Settings > VeriFactu shows, for the signed-in owner's clinic.
// The certificate and passphrase tables are service-role only, so this reads
// them here and returns what they say ABOUT themselves -- never the file or
// the passphrase.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireOwner(event)
  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)

  const [{ data: account }, { data: clinic }, { data: cert }, { data: secret }, { data: owed }, { data: last }, { count: productionRecords }, { count: testRecords }] =
    await Promise.all([
      admin.from('accounts').select('verifactu_mode, verifactu_production_from').eq('id', accountId).maybeSingle(),
      admin.from('clinics').select('tax_id, legal_name, name').eq('account_id', accountId).order('created_at').limit(1).maybeSingle(),
      admin.from('verifactu_certificates').select('certificate_type, subject, not_after, updated_at').eq('account_id', accountId).maybeSingle(),
      admin.from('account_secrets').select('updated_at').eq('account_id', accountId).eq('name', PASSPHRASE_SECRET_NAME).maybeSingle(),
      admin.rpc('factura_records_awaiting_aeat', { p_account_id: accountId }),
      admin
        .from('factura_record_submissions')
        .select('status, error_code, error_message, sent_at')
        .eq('account_id', accountId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      admin.from('factura_records').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('environment', 'production'),
      admin.from('factura_records').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('environment', 'test'),
    ])

  const owedRows = (owed ?? []) as { parked: boolean }[]
  return {
    mode: (account?.verifactu_mode ?? 'off') as 'off' | 'test' | 'live',
    productionFrom: account?.verifactu_production_from ?? null,
    // Once the production chain has started the AEAT holds it: the date and
    // the mode are fixed from then on (enforced by accounts_guard_verifactu).
    locked: (productionRecords ?? 0) > 0,
    company: { nif: clinic?.tax_id ?? null, legalName: clinic?.legal_name || null },
    certificate: cert
      ? {
          type: cert.certificate_type as 'representative' | 'seal',
          subject: cert.subject,
          notAfter: cert.not_after,
          updatedAt: cert.updated_at,
          hasPassphrase: Boolean(secret),
        }
      : null,
    platformKeyConfigured: Boolean(useRuntimeConfig().verifactuSecretKey),
    activity: {
      waiting: owedRows.filter((r) => !r.parked).length,
      parked: owedRows.filter((r) => r.parked).length,
      testRecords: testRecords ?? 0,
      productionRecords: productionRecords ?? 0,
      last: last ? { status: last.status, errorCode: last.error_code, errorMessage: last.error_message, sentAt: last.sent_at } : null,
    },
  }
})
