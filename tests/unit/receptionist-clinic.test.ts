import { describe, it, expect } from 'vitest'
import { clinicDetailsSection, clinicOpeningHours } from '../../utils/receptionistClinic'

// What the receptionist says about the clinic itself, from its settings
// (utils/receptionistClinic.ts) rather than a knowledge card.

// A clinic whose own hours say it opens on Fridays, while nobody who takes
// bookings works one -- the hours patients are seen are the practitioners'.
const clinicHours = { mon: [['09:00', '13:00'], ['16:00', '20:00']], fri: [['09:00', '14:00']] } as Record<string, [string, string][]>
const morning = { mon: [], tue: [['09:00', '14:00']], wed: [['15:00', '20:00']] } as Record<string, [string, string][]>
const afternoon = { mon: [['15:00', '20:00']], tue: [['09:30', '13:00'], ['15:00', '20:00']], wed: [] } as Record<string, [string, string][]>

describe('When the clinic sees patients', () => {
  it("is the practitioners' hours joined, not the clinic's", () => {
    const lines = clinicOpeningHours({ clinicHours, practitionerHours: [morning, afternoon] })!
    expect(lines).toContain('Monday: 15:00-20:00')
    expect(lines).toContain('Tuesday: 09:00-14:00 and 15:00-20:00')
    expect(lines).toContain('Friday: closed')
    expect(lines).toContain('Sunday: closed')
  })

  it("lends the clinic's hours to a practitioner with none of their own", () => {
    expect(clinicOpeningHours({ clinicHours, practitionerHours: [null] })).toContain('Friday: 09:00-14:00')
  })

  it('says nothing when nothing tells a closed day from an unconfigured one', () => {
    expect(clinicOpeningHours({ clinicHours: null, practitionerHours: [null] })).toBeNull()
    expect(clinicOpeningHours({ clinicHours: null, practitionerHours: [] })).toBeNull()
  })
})

describe('The clinic section of the prompt', () => {
  const clinic = { name: 'Clínica Demo', address: 'Calle Mayor 1 , Bajo 46001 Valencia', phone: '+34 600 000 000', email: null, clinicHours, practitionerHours: [afternoon] }

  it('gives the address, phone and hours, and says they win over the knowledge', () => {
    const text = clinicDetailsSection([clinic])
    expect(text).toContain('Address: Calle Mayor 1, Bajo 46001 Valencia')
    expect(text).toContain('Phone: +34 600 000 000')
    expect(text).not.toContain('Email:')
    expect(text).toContain('- Monday: 15:00-20:00')
    expect(text).toContain('wins over anything the clinic knowledge says')
  })

  it('names each location when there are several', () => {
    const text = clinicDetailsSection([clinic, { ...clinic, name: 'Clínica Demo Norte' }])
    expect(text).toContain('It has 2 locations.')
    expect(text).toContain('## Clínica Demo Norte')
  })

  it('is empty without a clinic', () => {
    expect(clinicDetailsSection([])).toBe('')
  })
})
