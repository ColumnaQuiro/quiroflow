import { describe, it, expect } from 'vitest'
import { attendanceCertificateText, certificateLanguage, visitWasAttended } from '../../utils/attendanceCertificate'

// The justificante a patient hands their employer. It must state the visit
// in the clinic's own clock, and only for a visit that took place.

describe('attendanceCertificateText', () => {
  const base = {
    patientName: 'Ana Pérez',
    nationalId: '12345678Z',
    clinicName: 'Clínica Demo S.L.',
    // 08:30-09:00 UTC is 10:30-11:00 in Madrid in October (CEST).
    startsAt: '2026-10-20T08:30:00Z',
    endsAt: '2026-10-20T09:00:00Z',
    timeZone: 'Europe/Madrid',
    practitionerName: 'Laura Gómez',
    issuedAt: new Date('2026-10-20T12:00:00Z'),
  }

  it('reads in Spanish with the DNI and the clinic-local times', () => {
    const text = attendanceCertificateText({ ...base, language: 'es' })
    expect(text.title).toBe('Justificante de asistencia')
    expect(text.body).toBe('Se hace constar que Ana Pérez, con DNI/NIE 12345678Z, ha asistido a consulta en Clínica Demo S.L. el martes, 20 de octubre de 2026, de 10:30 a 11:00 h.')
    expect(text.practitionerLine).toBe('Profesional: Laura Gómez')
  })

  it('leaves the ID clause out when the record has none', () => {
    expect(attendanceCertificateText({ ...base, nationalId: null, language: 'es' }).body).toContain('Ana Pérez ha asistido')
  })

  it('reads in English for an English-speaking patient', () => {
    // ICU versions differ on the comma after the weekday.
    expect(attendanceCertificateText({ ...base, language: 'en' }).body).toMatch(/attended an appointment at Clínica Demo S\.L\. on Tuesday,? 20 October 2026, from 10:30 to 11:00\.$/)
    expect(certificateLanguage('en')).toBe('en')
    expect(certificateLanguage('fr')).toBe('es')
  })
})

describe('visitWasAttended', () => {
  const v = (status: string, checkedIn: string | null = null, deleted: string | null = null) => ({ status, checked_in_at: checkedIn, deleted_at: deleted })
  it('is true for a completed visit or a checked-in one', () => {
    expect(visitWasAttended(v('completed'))).toBe(true)
    expect(visitWasAttended(v('booked', '2026-10-20T08:31:00Z'))).toBe(true)
    expect(visitWasAttended({ ...v('booked'), flow_with_practitioner_at: '2026-10-20T08:35:00Z' })).toBe(true)
  })
  it('is false for a future booking, a cancellation, a no-show or a deleted visit', () => {
    expect(visitWasAttended(v('booked'))).toBe(false)
    expect(visitWasAttended(v('cancelled', '2026-10-20T08:31:00Z'))).toBe(false)
    expect(visitWasAttended(v('no_show'))).toBe(false)
    expect(visitWasAttended(v('completed', null, '2026-10-21T00:00:00Z'))).toBe(false)
  })
})
