import { describe, it, expect } from 'vitest'
import {
  deriveAttendanceCertificateKey,
  signAttendanceCertificateLink,
  verifyAttendanceCertificateLink,
} from '../../server/utils/attendanceCertificateLink'

// The link a patient opens their justificante with, in a browser with no
// session: it has to name one visit, for a few minutes, and nothing else.

const key = deriveAttendanceCertificateKey('test-secret')
const appt = '3f0c6c1e-6a52-4a8e-9a39-1c2d3e4f5a6b'
const now = 1_800_000_000_000
const expires = now + 5 * 60_000

describe('attendance certificate link', () => {
  it('opens the visit it was signed for, while in date', () => {
    const sig = signAttendanceCertificateLink(key, appt, expires)
    expect(verifyAttendanceCertificateLink(key, appt, String(expires), sig, now)).toBe(appt)
  })

  it('is refused once it has expired', () => {
    const sig = signAttendanceCertificateLink(key, appt, expires)
    expect(verifyAttendanceCertificateLink(key, appt, String(expires), sig, expires + 1)).toBeNull()
  })

  it('cannot be pointed at another visit or given more time', () => {
    const sig = signAttendanceCertificateLink(key, appt, expires)
    const other = '3f0c6c1e-6a52-4a8e-9a39-1c2d3e4f5a6c'
    expect(verifyAttendanceCertificateLink(key, other, String(expires), sig, now)).toBeNull()
    expect(verifyAttendanceCertificateLink(key, appt, String(expires + 60_000), sig, now)).toBeNull()
  })

  it('is refused under another deployment’s key', () => {
    const sig = signAttendanceCertificateLink(deriveAttendanceCertificateKey('other-secret'), appt, expires)
    expect(verifyAttendanceCertificateLink(key, appt, String(expires), sig, now)).toBeNull()
  })

  it('refuses anything malformed rather than throwing', () => {
    const sig = signAttendanceCertificateLink(key, appt, expires)
    expect(verifyAttendanceCertificateLink(key, 'not-a-uuid', String(expires), sig, now)).toBeNull()
    expect(verifyAttendanceCertificateLink(key, appt, 'soon', sig, now)).toBeNull()
    expect(verifyAttendanceCertificateLink(key, appt, undefined, sig, now)).toBeNull()
    expect(verifyAttendanceCertificateLink(key, appt, String(expires), undefined, now)).toBeNull()
    expect(verifyAttendanceCertificateLink(key, appt, String(expires), ['a', 'b'], now)).toBeNull()
    expect(verifyAttendanceCertificateLink(key, appt, String(expires), 'x'.repeat(500), now)).toBeNull()
  })
})
