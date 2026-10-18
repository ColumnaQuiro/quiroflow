import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { describe, expect, it } from 'vitest'
import { bonoPassJson, buildBonoPkpass, walletLinkTokenWith, walletLinkValidWith, walletSigningFromPem, WALLET_PASS_TYPE_ID, type BonoPassData } from '../../server/utils/walletPkpass'

// The Apple Wallet pass (server/utils/walletPkpass.ts), checked from the
// outside: unpacked by Python's zipfile, its manifest against the files, and
// its signature by OpenSSL -- with a throwaway certificate, so nothing here
// needs the real one. Wallet's own acceptance needs a device.

function throwawaySigning() {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86400_000)
  cert.validity.notAfter = new Date(Date.now() + 86400_000)
  const attrs = [{ name: 'commonName', value: 'Pass Type ID: test' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return walletSigningFromPem(forge.pki.certificateToPem(cert), forge.pki.privateKeyToPem(keys.privateKey))
}
const signing = throwawaySigning()

const data: BonoPassData = {
  purchaseId: '6d1c2b6e-0b3f-4a4e-9a1d-2f9a7c1e5b10',
  patientId: '9a0e2c41-5d3b-4c7e-8f21-6b4d3a2e1c00',
  holder: 'Lucía Navarro',
  bono: 'Ajuste · 10 sesiones',
  total: 10,
  used: 4,
  closed: false,
  accountName: 'Clínica Demo',
  clinicName: 'Clínica Demo Centro',
  clinicPhone: '600 000 000',
  clinicAddress: 'Calle Mayor 1',
  timezone: 'Europe/Madrid',
  brandColor: '#1F5F57',
  logo: null,
  nextVisit: { startsAt: new Date(Date.now() + 3 * 86400_000).toISOString(), what: 'Ajuste', who: 'Dra. Marta Ruiz' },
  authToken: 'a'.repeat(48),
}

describe('bonoPassJson', () => {
  it('shows sessions left, the next visit and a QR to the record, in the clinic’s colour', () => {
    const p = bonoPassJson(data, 'https://app.quiroflow.com') as any
    expect(p.passTypeIdentifier).toBe(WALLET_PASS_TYPE_ID)
    expect(p.serialNumber).toBe(data.purchaseId)
    expect(p.webServiceURL).toBe('https://app.quiroflow.com/api/wallet')
    expect(p.storeCard.headerFields[0]).toMatchObject({ key: 'left', value: 6 })
    expect(p.storeCard.secondaryFields[0].label).toBe('PRÓXIMA VISITA')
    expect(p.relevantDate).toBe(data.nextVisit!.startsAt)
    expect(p.barcodes[0].message).toBe(`https://app.quiroflow.com/patients/${data.patientId}`)
    expect(p.backgroundColor).toBe('rgb(31,95,87)')
    expect(p.foregroundColor).toBe('rgb(255,255,255)')
  })
  it('writes dark text on a light clinic colour, and voids a closed bono', () => {
    const p = bonoPassJson({ ...data, brandColor: '#F2F0E8', closed: true }, 'https://x') as any
    expect(p.foregroundColor).toBe('rgb(21,23,30)')
    expect(p.voided).toBe(true)
    expect(bonoPassJson({ ...data, nextVisit: null }, 'https://x')).not.toHaveProperty('relevantDate')
  })
})

describe('buildBonoPkpass', () => {
  it('is a ZIP whose manifest matches every file and whose signature verifies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkpass-'))
    const file = join(dir, 'bono.pkpass')
    writeFileSync(file, buildBonoPkpass(data, 'https://app.quiroflow.com', signing))
    execFileSync('python3', ['-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nz.extractall(sys.argv[2])', file, dir])
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, string>
    expect(Object.keys(manifest).sort()).toEqual(['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'logo@3x.png', 'pass.json'])
    for (const [name, sha1] of Object.entries(manifest)) expect(createHash('sha1').update(readFileSync(join(dir, name))).digest('hex'), name).toBe(sha1)
    expect(JSON.parse(readFileSync(join(dir, 'pass.json'), 'utf8')).serialNumber).toBe(data.purchaseId)
    // Detached CMS over manifest.json; -noverify skips the chain (a throwaway
    // certificate), not the signature itself.
    const out = execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(dir, 'signature'), '-content', join(dir, 'manifest.json'), '-noverify', '-out', '/dev/null'], { stdio: ['ignore', 'pipe', 'pipe'] })
    expect(out).toBeDefined()
  })
  it('uses the clinic’s own logo when it has one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkpass-'))
    const file = join(dir, 'bono.pkpass')
    writeFileSync(file, buildBonoPkpass({ ...data, logo: new Uint8Array([137, 80, 78, 71]) }, 'https://x', signing))
    const names = execFileSync('python3', ['-c', 'import zipfile,sys\nprint("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', file]).toString().trim().split('\n')
    expect(names).toContain('logo.png')
    expect(names).not.toContain('logo@2x.png')
  })
})

describe('the add-to-Wallet link', () => {
  it('is valid for its bono until it expires, and for nothing else', () => {
    const exp = Date.now() + 60_000
    const token = walletLinkTokenWith(signing, data.purchaseId, exp)
    expect(walletLinkValidWith(signing, data.purchaseId, exp, token)).toBe(true)
    expect(walletLinkValidWith(signing, data.patientId, exp, token)).toBe(false)
    expect(walletLinkValidWith(signing, data.purchaseId, exp + 1, token)).toBe(false)
    expect(walletLinkValidWith(signing, data.purchaseId, exp, token, exp + 1)).toBe(false)
    expect(walletLinkValidWith(signing, data.purchaseId, exp, 'x')).toBe(false)
  })
})
