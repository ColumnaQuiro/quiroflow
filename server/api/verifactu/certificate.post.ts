import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { CertificateError, PASSPHRASE_SECRET_NAME, encryptSecret, readPkcs12 } from '~/server/utils/verifactuCertificate'

// Stores the clinic's VeriFactu certificate: the .p12 and its passphrase.
//
// The file is opened here with the passphrase exactly as the sender will open
// it, so a certificate that is accepted is one that can transmit -- rather
// than finding out a minute later as a transport error on every record.
const MAX_CERTIFICATE_BYTES = 64 * 1024

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireOwner(event)
  const body = await readBody<{ fileBase64?: string; passphrase?: string; certificateType?: string }>(event)

  const fileBase64 = (body?.fileBase64 ?? '').replace(/^data:[^,]*,/, '')
  const passphrase = body?.passphrase ?? ''
  const certificateType = body?.certificateType === 'seal' ? 'seal' : 'representative'
  if (!fileBase64) throw createError({ statusCode: 400, statusMessage: 'Choose the certificate file (.p12 or .pfx)' })
  if (!passphrase) throw createError({ statusCode: 400, statusMessage: 'Enter the certificate’s password' })

  const pfx = Buffer.from(fileBase64, 'base64')
  if (pfx.length === 0 || pfx.length > MAX_CERTIFICATE_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'That file is not a certificate' })
  }

  const secretKey = String(useRuntimeConfig().verifactuSecretKey ?? '')
  if (!secretKey) {
    throw createError({ statusCode: 503, statusMessage: 'Certificates cannot be stored yet: the platform key (NUXT_VERIFACTU_SECRET_KEY) is not configured' })
  }

  let details: ReturnType<typeof readPkcs12>
  try {
    details = readPkcs12(pfx, passphrase)
  } catch (err) {
    const problem = err instanceof CertificateError ? err.problem : 'not-a-certificate'
    const message = {
      'wrong-passphrase': 'The password does not open this certificate',
      'legacy-format': 'This certificate was exported in an old format. Export it again from your browser or the FNMT tool with modern (AES) encryption and upload that file',
      'not-a-certificate': 'That file is not a certificate (.p12 or .pfx)',
    }[problem]
    throw createError({ statusCode: 400, statusMessage: message })
  }
  if (details.notAfter && details.notAfter <= new Date()) {
    throw createError({ statusCode: 400, statusMessage: 'This certificate has expired' })
  }

  let encrypted: string
  try {
    encrypted = encryptSecret(passphrase, secretKey)
  } catch (err) {
    throw createError({ statusCode: 503, statusMessage: err instanceof Error ? err.message : 'The platform key is not valid' })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const now = new Date().toISOString()
  const { error: certError } = await admin.from('verifactu_certificates').upsert(
    {
      account_id: teamMember.account_id,
      pkcs12_base64: pfx.toString('base64'),
      certificate_type: certificateType,
      subject: details.subject,
      not_after: details.notAfter?.toISOString() ?? null,
      updated_at: now,
    },
    { onConflict: 'account_id' },
  )
  if (certError) throw createError({ statusCode: 500, statusMessage: certError.message })

  const { error: secretError } = await admin
    .from('account_secrets')
    .upsert({ account_id: teamMember.account_id, name: PASSPHRASE_SECRET_NAME, value: encrypted, updated_at: now }, { onConflict: 'account_id,name' })
  if (secretError) throw createError({ statusCode: 500, statusMessage: secretError.message })

  return { subject: details.subject, notAfter: details.notAfter?.toISOString() ?? null, type: certificateType }
})
