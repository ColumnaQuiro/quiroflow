import { describe, expect, it } from 'vitest'
import { patientIdFromPassLink } from '../../utils/passLink'

// The bono pass's QR, read back into the patient by the staff app's scanner
// and by the camera opening the app on the link.

const ID = '3f2b8c1e-9a4d-4e6b-8f1a-2c3d4e5f6a7b'

describe('The patient a pass QR names', () => {
  it('reads the link the pass carries', () => {
    expect(patientIdFromPassLink(`https://app.quiroflow.com/patients/${ID}`)).toBe(ID)
    expect(patientIdFromPassLink(` https://app.quiroflow.com/patients/${ID.toUpperCase()}/ `)).toBe(ID)
  })

  it('refuses anything that is not a QuiroFlow patient link', () => {
    expect(patientIdFromPassLink(`https://evil.example/patients/${ID}`)).toBeNull()
    expect(patientIdFromPassLink(`https://quiroflow.com.evil.example/patients/${ID}`)).toBeNull()
    expect(patientIdFromPassLink(`http://app.quiroflow.com/patients/${ID}`)).toBeNull()
    expect(patientIdFromPassLink('https://app.quiroflow.com/patients/not-an-id')).toBeNull()
    expect(patientIdFromPassLink(`https://app.quiroflow.com/patients/${ID}/files`)).toBeNull()
    expect(patientIdFromPassLink('just some text')).toBeNull()
    expect(patientIdFromPassLink(null)).toBeNull()
  })
})
