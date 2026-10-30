import { describe, expect, it } from 'vitest'
import { birthDateMatches, maskedPortalName, normalizeNationalId, parsePortalBirthDate, pickPortalVisit } from '../../utils/checkInPortal'

// The front-desk check-in portal: a date of birth typed as DDMMAA, matched
// against the visits about to start at the location.
describe('parsePortalBirthDate', () => {
  it('reads day, month and the year’s last two digits', () => {
    expect(parsePortalBirthDate('070385')).toEqual({ day: 7, month: 3, yy: 85 })
    expect(parsePortalBirthDate('311299')).toEqual({ day: 31, month: 12, yy: 99 })
  })
  it('refuses a date that does not exist, and anything not six digits', () => {
    expect(parsePortalBirthDate('310485')).toBeNull()
    expect(parsePortalBirthDate('001085')).toBeNull()
    expect(parsePortalBirthDate('011385')).toBeNull()
    expect(parsePortalBirthDate('29021')).toBeNull()
    expect(parsePortalBirthDate('29-02-')).toBeNull()
  })
  it('allows 29 February only for a year that was a leap year in either century', () => {
    expect(parsePortalBirthDate('290200')).not.toBeNull()
    expect(parsePortalBirthDate('290284')).not.toBeNull()
    expect(parsePortalBirthDate('290201')).toBeNull()
  })
})

describe('birthDateMatches', () => {
  const typed = parsePortalBirthDate('070385')!
  it('matches the same day, month and two-digit year', () => {
    expect(birthDateMatches('1985-03-07', typed)).toBe(true)
    expect(birthDateMatches('1985-07-03', typed)).toBe(false)
    expect(birthDateMatches('1986-03-07', typed)).toBe(false)
  })
  it('never matches a patient with no date of birth', () => {
    expect(birthDateMatches(null, typed)).toBe(false)
    expect(birthDateMatches('', typed)).toBe(false)
  })
})

describe('normalizeNationalId', () => {
  it('compares a DNI or NIE however it was written down or typed', () => {
    expect(normalizeNationalId('12.345.678-z')).toBe('12345678Z')
    expect(normalizeNationalId(' 12345678Z ')).toBe('12345678Z')
    expect(normalizeNationalId('x-1234567-l')).toBe('X1234567L')
  })
  it('is null for nothing, or too little to be a document', () => {
    expect(normalizeNationalId(null)).toBeNull()
    expect(normalizeNationalId('')).toBeNull()
    expect(normalizeNationalId('12-3')).toBeNull()
  })
})

describe('maskedPortalName', () => {
  it('shows only initials to the waiting room', () => {
    expect(maskedPortalName('maría', 'García')).toBe('M••• G.')
    expect(maskedPortalName('Leo', null)).toBe('L•••')
    expect(maskedPortalName(null, null)).toBe('•••')
  })
})

describe('pickPortalVisit', () => {
  const v = (id: string, patient: string, startsAt: string, checkedIn: string | null = null) => ({ id, patient_id: patient, starts_at: startsAt, checked_in_at: checkedIn })
  it('is none when nobody due has that birthday', () => {
    expect(pickPortalVisit([])).toEqual({ kind: 'none' })
  })
  it('checks in the one patient’s earliest visit not yet checked in', () => {
    const r = pickPortalVisit([v('b', 'p1', '2026-10-30T10:30:00Z'), v('a', 'p1', '2026-10-30T10:00:00Z', '2026-10-30T09:50:00Z')])
    expect(r).toEqual({ kind: 'visit', visit: expect.objectContaining({ id: 'b' }) })
  })
  it('answers with their first visit when every one is already checked in', () => {
    const r = pickPortalVisit([v('a', 'p1', '2026-10-30T10:00:00Z', '2026-10-30T09:50:00Z')])
    expect(r).toEqual({ kind: 'visit', visit: expect.objectContaining({ id: 'a', checked_in_at: '2026-10-30T09:50:00Z' }) })
  })
  it('asks which one when two patients share the birthday, one option each', () => {
    const visits = [v('a', 'p1', '2026-10-30T10:00:00Z'), v('b', 'p2', '2026-10-30T10:15:00Z'), v('c', 'p1', '2026-10-30T11:00:00Z')]
    const r = pickPortalVisit(visits)
    expect(r.kind).toBe('choose')
    expect(r.kind === 'choose' && r.options.map((o) => o.id)).toEqual(['a', 'b'])
    expect(pickPortalVisit(visits, 'b')).toEqual({ kind: 'visit', visit: expect.objectContaining({ id: 'b' }) })
  })
  it('treats a chosen visit that is no longer due as not found', () => {
    expect(pickPortalVisit([v('a', 'p1', '2026-10-30T10:00:00Z')], 'gone')).toEqual({ kind: 'none' })
  })
})
