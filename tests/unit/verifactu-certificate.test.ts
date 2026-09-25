import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { CertificateError, decryptSecret, encryptSecret, readPkcs12 } from '../../server/utils/verifactuCertificate'

// Each clinic's certificate passphrase is stored encrypted with one platform
// key, so the database alone is not a usable certificate. And a certificate
// is opened with its passphrase when it is uploaded, exactly as the sender
// will open it -- so one that is accepted is one that can transmit.
describe('The certificate passphrase at rest', () => {
  const key = randomBytes(32).toString('base64')

  it('comes back as it went in, with the platform key', () => {
    const stored = encryptSecret('123456', key)
    expect(stored).to.match(/^v1:/)
    expect(stored).not.to.contain('123456')
    expect(decryptSecret(stored, key)).to.eq('123456')
  })

  it('does not open with any other key', () => {
    const stored = encryptSecret('123456', key)
    expect(() => decryptSecret(stored, randomBytes(32).toString('base64'))).to.throw()
  })

  it('refuses a platform key that is not 32 bytes, naming how to make one', () => {
    expect(() => encryptSecret('x', 'too-short')).to.throw(/openssl rand -base64 32/)
  })
})

// openssl writes a real PKCS#12, the same format a clinic uploads.
function makeP12(password: string): Buffer | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'p12-'))
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '400', '-subj', '/CN=PRUEBA - 00000000T/O=Clinica Prueba SL'], { stdio: 'ignore' })
    execFileSync('openssl', ['pkcs12', '-export', '-inkey', join(dir, 'k.pem'), '-in', join(dir, 'c.pem'), '-out', join(dir, 'c.p12'), '-passout', `pass:${password}`, '-keypbe', 'AES-256-CBC', '-certpbe', 'AES-256-CBC', '-macalg', 'sha256'], { stdio: 'ignore' })
    return readFileSync(join(dir, 'c.p12'))
  } catch {
    return null
  }
}

describe('Reading an uploaded certificate', () => {
  const p12 = makeP12('1234')

  it.skipIf(!p12)('reads who it belongs to and when it expires', () => {
    const { subject, notAfter } = readPkcs12(p12!, '1234')
    expect(subject).to.contain('Clinica Prueba SL')
    expect(notAfter!.getTime()).to.be.greaterThan(Date.now())
  })

  it.skipIf(!p12)('says a wrong password is a wrong password', () => {
    expect(() => readPkcs12(p12!, 'nope')).to.throw(CertificateError).with.property('problem', 'wrong-passphrase')
  })

  it('says a file that is not a certificate is not one', () => {
    expect(() => readPkcs12(Buffer.from('not a certificate'), 'x')).to.throw(CertificateError).with.property('problem', 'not-a-certificate')
  })
})
