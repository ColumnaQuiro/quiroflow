import { describe, expect, it } from 'vitest'
import { outsideHoursInZone } from '../../utils/staffQuietHours'

// Monday 5 Oct 2026. Madrid is UTC+2 (CEST) on that day.
const madrid = 'Europe/Madrid'
const at = (utc: string) => new Date(`2026-10-05T${utc}:00Z`)
const clinic = { mon: [['09:00', '14:00'], ['16:00', '20:00']] as [string, string][] }

describe('outsideHoursInZone', () => {
  it('reads the hours in the clinic’s zone, not the server’s', () => {
    // 07:30 UTC is 09:30 in Madrid: working.
    expect(outsideHoursInZone(at('07:30'), madrid, clinic, null)).toBe(false)
    // 06:30 UTC is 08:30 in Madrid: not yet.
    expect(outsideHoursInZone(at('06:30'), madrid, clinic, null)).toBe(true)
  })

  it('treats the lunch gap as outside', () => {
    // 13:00 UTC is 15:00 in Madrid.
    expect(outsideHoursInZone(at('13:00'), madrid, clinic, null)).toBe(true)
  })

  it('uses the practitioner’s own hours over the clinic’s', () => {
    const own = { mon: [['15:00', '21:00']] as [string, string][] }
    expect(outsideHoursInZone(at('07:30'), madrid, clinic, own)).toBe(true)
    expect(outsideHoursInZone(at('18:30'), madrid, clinic, own)).toBe(false)
  })

  it('is never outside when nobody set any hours', () => {
    expect(outsideHoursInZone(at('02:00'), madrid, null, null)).toBe(false)
  })

  it('is outside all day on a day they do not work', () => {
    const own = { tue: [['09:00', '18:00']] as [string, string][] }
    expect(outsideHoursInZone(at('09:00'), madrid, clinic, own)).toBe(true)
  })
})
