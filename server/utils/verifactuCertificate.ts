import { createCipheriv, createDecipheriv, randomBytes, X509Certificate } from 'node:crypto'
import { createSecureContext } from 'node:tls'

// A clinic's VeriFactu certificate and its passphrase, per account.
//
// The certificate (base64 PKCS#12) is in verifactu_certificates and the
// passphrase in account_secrets -- both service-role only. The passphrase is
// also encrypted with one platform key, NUXT_VERIFACTU_SECRET_KEY, which
// lives only in the deploy. That keeps the rule the certificate store was
// built on: a copy of the database alone is not a usable certificate, and
// neither is the deploy alone. It used to be kept by holding the passphrase
// itself in the environment, which only works while there is one clinic.
//
// No Nuxt globals in here, so the unit tests can import it directly.

export const PASSPHRASE_SECRET_NAME = 'verifactu_certificate_passphrase'

function keyFrom(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64 ?? '', 'base64')
  if (key.length !== 32) {
    throw new Error('NUXT_VERIFACTU_SECRET_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)')
  }
  return key
}

/** AES-256-GCM. Stored as "v1:<iv>:<tag>:<ciphertext>", each part base64. */
export function encryptSecret(plaintext: string, keyBase64: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyBase64), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptSecret(stored: string, keyBase64: string): string {
  const [version, iv, tag, ciphertext] = stored.split(':')
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognised encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyBase64), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

export type CertificateProblem = 'wrong-passphrase' | 'legacy-format' | 'not-a-certificate'

export class CertificateError extends Error {
  constructor(public problem: CertificateProblem) {
    super(problem)
  }
}

/**
 * Opens the .p12 with its passphrase -- the same way the sender will, so a
 * certificate that passes here is one the sender can use -- and reads who it
 * belongs to and when it expires.
 *
 * The failures are named, because OpenSSL's own messages are no help at a
 * clinic's front desk: "mac verify failure" is a wrong passphrase, and
 * "unsupported" is a .p12 written by an older tool in RC2-40-CBC, which the
 * OpenSSL 3 inside Node refuses. Columnaquiro's first certificate was exactly
 * that, and had to be re-exported before anything could load it.
 */
export function readPkcs12(pfx: Buffer, passphrase: string): { subject: string | null; notAfter: Date | null } {
  let context: ReturnType<typeof createSecureContext>
  try {
    context = createSecureContext({ pfx, passphrase })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/mac verify failure|bad decrypt/i.test(message)) throw new CertificateError('wrong-passphrase')
    if (/unsupported/i.test(message)) throw new CertificateError('legacy-format')
    throw new CertificateError('not-a-certificate')
  }

  // Not in Node's documented API, but present in every current release. If a
  // future one drops it, the certificate still loads and is still stored --
  // only the name and expiry go unread, and the page says so.
  const der = (context.context as { getCertificate?: () => Buffer | null }).getCertificate?.()
  if (!der) return { subject: null, notAfter: null }
  const certificate = new X509Certificate(der)
  return {
    subject: certificate.subject.replace(/\n/g, ', '),
    notAfter: new Date(certificate.validTo),
  }
}
