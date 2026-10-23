import { describe, expect, it } from 'vitest'
import {
  emptyFilterForm,
  filtersFromQuery,
  filtersToForm,
  filtersToQuery,
  formToFilters,
  normalizeFilters,
  queryHasFilters,
  sameFilters,
} from '../../utils/patientFilters'

// The patient list's filters (utils/patientFilters.ts): one object for the
// toolbar, the URL, a saved segment and patients_matching.
describe('patient filters', () => {
  it('an untouched toolbar filters nothing, and active is the default status', () => {
    expect(formToFilters(emptyFilterForm())).toEqual({})
    expect(formToFilters({ ...emptyFilterForm(), status: 'any' })).toEqual({ status: 'any' })
  })

  it('round-trips through the URL', () => {
    const filters = normalizeFilters({
      status: 'inactive',
      q: 'ana 612',
      tags: ['vip', 'bono'],
      futureAppointment: 'no',
      bono: 'active',
      bonoSessionsMax: 2,
      balance: 'owing',
      createdFrom: '2026-10-01',
      createdTo: '2026-10-31',
      birthdayThisMonth: true,
      doNotContact: true,
    })
    const query = filtersToQuery(filters)
    expect(query).toMatchObject({ tags: 'bono,vip', bonoSessionsMax: '2', birthdayThisMonth: '1', doNotContact: '1' })
    expect(filtersFromQuery(query)).toEqual(filters)
    expect(formToFilters(filtersToForm(filters))).toEqual(filters)
  })

  it('drops what the database could not read', () => {
    expect(
      filtersFromQuery({
        practitioner: 'not-a-uuid',
        lastVisitFrom: '1 Oct',
        bono: 'maybe',
        app: ['yes', 'no'],
        clinic: 'all',
      }),
    ).toEqual({ app: 'yes', clinic: 'all' })
  })

  it('keeps a session cap only with a live bono', () => {
    expect(normalizeFilters({ bono: 'none', bonoSessionsMax: '2' })).toEqual({ bono: 'none' })
    expect(normalizeFilters({ bono: 'active', bonoSessionsMax: '-1' })).toEqual({ bono: 'active' })
    expect(normalizeFilters({ bono: 'active', bonoSessionsMax: '0' })).toEqual({ bono: 'active', bonoSessionsMax: 0 })
  })

  it('compares regardless of key and tag order', () => {
    expect(sameFilters({ tags: ['b', 'a'], balance: 'owing' }, { balance: 'owing', tags: ['a', 'b'] })).toBe(true)
    expect(sameFilters({ balance: 'owing' }, { balance: 'credit' })).toBe(false)
  })

  it('a bare segment link names no filters', () => {
    expect(queryHasFilters({ segment: 'abc' })).toBe(false)
    expect(queryHasFilters({ segment: 'abc', minors: '1' })).toBe(true)
  })
})
