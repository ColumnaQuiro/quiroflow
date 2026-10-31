import { describe, it, expect } from 'vitest'
import { screenTitle } from '../../utils/screenTitle'

// The browser-tab title of a staff screen (utils/screenTitle.ts).

const en = (en: string) => en
const es = (_en: string, es: string) => es

describe('screenTitle', () => {
  it('names a screen the way the sidebar does, in the interface language', () => {
    expect(screenTitle('/practitioner', en)).toBe('My Day · QuiroFlow')
    expect(screenTitle('/practitioner', es)).toBe('Mi día · QuiroFlow')
    expect(screenTitle('/settings/whatsapp', en)).toBe('Settings · QuiroFlow')
  })

  it('tells a list from one of its records, and never names the patient', () => {
    expect(screenTitle('/patients', en)).toBe('Patients · QuiroFlow')
    expect(screenTitle('/patients/2b1c', en)).toBe('Patient · QuiroFlow')
    expect(screenTitle('/patients/posture/2b1c', en)).toBe('Posture · QuiroFlow')
    expect(screenTitle('/billing/new', en)).toBe('New receipt · QuiroFlow')
    expect(screenTitle('/billing/9f3a', en)).toBe('Receipt · QuiroFlow')
  })

  it('matches whole path segments, not any prefix', () => {
    expect(screenTitle('/growth/leads', en)).toBe('Leads · QuiroFlow')
    expect(screenTitle('/growth', en)).toBe('Growth · QuiroFlow')
    expect(screenTitle('/inboxes', en)).toBeNull()
  })

  it('leaves the patient-facing pages alone', () => {
    expect(screenTitle('/waitlist', en)).toBe('Waitlist · QuiroFlow')
    expect(screenTitle('/waitlist/abc123', en)).toBeNull()
    expect(screenTitle('/book/clinica-demo', en)).toBeNull()
    expect(screenTitle('/portal/appointments', en)).toBeNull()
  })
})
