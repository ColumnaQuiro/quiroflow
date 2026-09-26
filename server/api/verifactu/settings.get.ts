import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { PASSPHRASE_SECRET_NAME, decryptSecret, readPkcs12 } from '~/server/utils/verifactuCertificate'

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
      admin.from('verifactu_certificates').select('pkcs12_base64, certificate_type, subject, not_after, updated_at').eq('account_id', accountId).maybeSingle(),
      admin.from('account_secrets').select('value, updated_at').eq('account_id', accountId).eq('name', PASSPHRASE_SECRET_NAME).maybeSingle(),
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
  const secretKey = String(useRuntimeConfig().verifactuSecretKey ?? '')

  // The checks behind the certificate's status label. Each is what the sender
  // itself depends on, answered here rather than discovered at the first send.
  let checks: CertificateChecks | null = null
  if (cert) {
    const nif = normaliseNif(clinic?.tax_id)
    // Spanish company certificates name the company's NIF in the subject --
    // "organizationIdentifier=VATES-B16365504", "(R: B16365504)" -- so a
    // certificate for a different company is caught by reading it.
    const belongsToCompany = nif ? normaliseNif(cert.subject).includes(nif) : null

    // Opened with the stored password, exactly as the sender opens it: the
    // platform key decrypts the password, and the password opens the file.
    let passwordOpens: boolean | null = null
    if (secret?.value && secretKey) {
      try {
        readPkcs12(Buffer.from(cert.pkcs12_base64, 'base64'), decryptSecret(secret.value, secretKey))
        passwordOpens = true
      } catch {
        passwordOpens = false
      }
    } else if (!secret?.value) {
      passwordOpens = false
    }

    // What the AEAT has said since this certificate was stored. An accepted
    // record proves the connection end to end; a refusal proves the AEAT took
    // the connection but not the record, and says why.
    const { data: since } = await admin
      .from('factura_record_submissions')
      .select('status, error_code, error_message, sent_at')
      .eq('account_id', accountId)
      .gte('sent_at', cert.updated_at)
      .order('sent_at', { ascending: false })
      .limit(20)
    const accepted = (since ?? []).find((r) => r.status === 'Correcto' || r.status === 'AceptadoConErrores')
    const latest = (since ?? [])[0]
    const aeat = accepted
      ? { state: 'accepted' as const, at: accepted.sent_at, message: null }
      : latest?.status === 'Incorrecto'
        ? { state: 'refused' as const, at: latest.sent_at, message: [latest.error_code, latest.error_message].filter(Boolean).join(' ') }
        : latest?.status === 'transport_error'
          ? { state: 'unreachable' as const, at: latest.sent_at, message: latest.error_message }
          : { state: 'unused' as const, at: null, message: null }

    const expired = !!cert.not_after && new Date(cert.not_after) <= new Date()
    checks = {
      belongsToCompany,
      expired,
      passwordOpens,
      aeat,
      valid: belongsToCompany !== false && !expired && passwordOpens === true,
    }
  }

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
          checks,
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

interface CertificateChecks {
  /** null when the clinic has no NIF to compare against. */
  belongsToCompany: boolean | null
  expired: boolean
  /** null when the platform key is not configured, so it cannot be tried. */
  passwordOpens: boolean | null
  aeat: { state: 'accepted' | 'refused' | 'unreachable' | 'unused'; at: string | null; message: string | null }
  /** Everything the sender needs from the certificate itself is in order. */
  valid: boolean
}

function normaliseNif(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '')
}
