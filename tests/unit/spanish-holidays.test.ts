import { describe, expect, it } from 'vitest'
import { HOLIDAY_REGIONS, HOLIDAY_YEARS, HOLIDAYS_KNOWN_THROUGH, holidaysFor } from '../../utils/spanishHolidays'

// The BOE's tables, read the way a clinic sees them: national days
// everywhere, regional ones only in their comunidad, and that year's
// substitutions rather than a fixed pattern.
describe('holidaysFor', () => {
  it('gives every region the national holidays', () => {
    for (const region of Object.keys(HOLIDAY_REGIONS)) {
      const dates = holidaysFor(region, '2026-01-01', '2026-12-31').map((h) => h.date)
      expect(dates).toEqual(expect.arrayContaining(['2026-01-01', '2026-01-06', '2026-04-03', '2026-05-01', '2026-08-15', '2026-10-12', '2026-12-08', '2026-12-25']))
    }
  })

  it('keeps a regional holiday to its own comunidad', () => {
    expect(holidaysFor('ES-MD', '2026-05-02', '2026-05-02')).toEqual([{ date: '2026-05-02', name: 'Fiesta de la Comunidad de Madrid' }])
    expect(holidaysFor('ES-CT', '2026-05-02', '2026-05-02')).toEqual([])
    expect(holidaysFor('ES-CT', '2026-09-11', '2026-09-11').map((h) => h.date)).toEqual(['2026-09-11'])
  })

  it("follows the year's substitutions, not a fixed calendar", () => {
    // 1 Nov 2026 is a Sunday: Madrid moves it to Monday 2; Cataluña does not.
    expect(holidaysFor('ES-MD', '2026-11-01', '2026-11-02').map((h) => h.date)).toEqual(['2026-11-02'])
    expect(holidaysFor('ES-CT', '2026-11-01', '2026-11-02')).toEqual([])
    // 15 Aug 2027 is a Sunday: Andalucía rests on the 16th.
    expect(holidaysFor('ES-AN', '2027-08-15', '2027-08-16').map((h) => h.date)).toEqual(['2027-08-16'])
  })

  it('is inclusive at both ends and in date order', () => {
    const h = holidaysFor('ES-VC', '2026-03-19', '2026-04-06').map((x) => x.date)
    expect(h).toEqual(['2026-03-19', '2026-04-03', '2026-04-06'])
  })

  it('knows each year it lists to the last day', () => {
    expect(HOLIDAY_YEARS).toEqual(expect.arrayContaining([2026, 2027]))
    expect(HOLIDAYS_KNOWN_THROUGH).toBe(`${HOLIDAY_YEARS[HOLIDAY_YEARS.length - 1]}-12-31`)
    for (const year of HOLIDAY_YEARS) {
      // Every comunidad has 12 to 14 regional and national days a year -- 11
      // in Canarias, whose twelfth is each island's own, in a BOE footnote --
      // and the two local ones come on top, outside the BOE.
      for (const region of Object.keys(HOLIDAY_REGIONS)) {
        const n = holidaysFor(region, `${year}-01-01`, `${year}-12-31`).length
        expect(n, `${region} ${year}`).toBeGreaterThanOrEqual(region === 'ES-CN' ? 11 : 12)
        expect(n, `${region} ${year}`).toBeLessThanOrEqual(14)
      }
    }
  })
})
