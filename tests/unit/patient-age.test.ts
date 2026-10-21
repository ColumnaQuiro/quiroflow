import { describe, expect, it } from 'vitest'
import { patientAge } from '../../utils/patientAge'

// A patient's age from their date of birth (utils/patientAge.ts), shown in the
// banner, the patient list, the export and live beside the date input.

describe('patientAge', () => {
  it('counts whole years, the birthday itself included', () => {
    expect(patientAge('1990-09-27', '2026-09-26')).toBe(35)
    expect(patientAge('1990-09-27', '2026-09-27')).toBe(36)
    expect(patientAge('2010-01-01', '2026-10-21')).toBe(16)
  })

  it('turns someone born on 29 February a year older on 1 March', () => {
    expect(patientAge('2008-02-29', '2026-02-28')).toBe(17)
    expect(patientAge('2008-02-29', '2026-03-01')).toBe(18)
  })

  it('is null with no date, a future date or a half-typed year', () => {
    expect(patientAge(null)).toBeNull()
    expect(patientAge('')).toBeNull()
    expect(patientAge('2030-01-01', '2026-10-21')).toBeNull()
    expect(patientAge('0019-05-01', '2026-10-21')).toBeNull()
  })

  it('reads today on the local calendar, not in UTC', () => {
    // 23:30 on the 26th is the 26th, even where UTC is already the 27th.
    expect(patientAge('1990-09-27', new Date(2026, 8, 26, 23, 30))).toBe(35)
  })
})
