import { describe, expect, it } from 'vitest'
import { familyPushReach, familyPushTitle, guardianLinkStands } from '../../utils/familyPush'

describe('which pushes reach the family members who manage a patient', () => {
  it('visits reach every link, clinical ones full links only, broadcasts nobody', () => {
    expect(familyPushReach('appointment_reminder')).toBe('any')
    expect(familyPushReach('appointment_confirmation')).toBe('any')
    expect(familyPushReach('patient_app_message')).toBe('full')
    expect(familyPushReach('exercises')).toBe('full')
    expect(familyPushReach('learn')).toBe('full')
    expect(familyPushReach('clinic_announcement')).toBeNull()
    expect(familyPushReach('learn_library')).toBeNull()
    expect(familyPushReach(undefined)).toBeNull()
  })

  it('a guardian link stands until the sixteenth birthday, the same rule as the database', () => {
    const today = new Date('2026-11-06T12:00:00Z')
    expect(guardianLinkStands('2010-11-07', false, today)).toBe(true)
    expect(guardianLinkStands('2010-11-06', false, today)).toBe(false)
    expect(guardianLinkStands('2019-03-01', false, today)).toBe(true)
    // No date of birth: only while the record is flagged a minor.
    expect(guardianLinkStands(null, true, today)).toBe(true)
    expect(guardianLinkStands(null, false, today)).toBe(false)
  })

  it('names whose visit it is', () => {
    expect(familyPushTitle('Lucas', 'Mañana a las 10:00')).toBe('Lucas · Mañana a las 10:00')
    expect(familyPushTitle('', 'Mañana')).toBe('Mañana')
  })
})
