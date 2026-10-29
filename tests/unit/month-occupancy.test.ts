import { describe, expect, it } from 'vitest'
import { hoursLabel, monthOccupancy } from '../../utils/monthOccupancy'

// The calendar's Month view (utils/monthOccupancy.ts): working time, booked
// time and what is left free, per day. Local times throughout, as the grid.
const monday = new Date(2026, 10, 2) // Mon 2 Nov 2026
const tuesday = new Date(2026, 10, 3)
const at = (d: Date, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const x = new Date(d)
  x.setHours(h!, m!, 0, 0)
  return x.toISOString()
}
const ana = { id: 'ana', business_hours: { mon: [['09:00', '14:00'], ['16:00', '19:00']] as [string, string][], tue: [] } }
const luis = { id: 'luis', business_hours: null }
const visit = (who: string, d: Date, from: string, to: string) => ({ practitioner_id: who, starts_at: at(d, from), ends_at: at(d, to) })

describe('monthOccupancy', () => {
  it('measures booked against the practitioner’s own hours, less their blocks', () => {
    const [mon, tue] = monthOccupancy({
      days: [monday, tuesday],
      practitioners: [ana],
      clinicHours: null,
      appointments: [visit('ana', monday, '09:00', '10:00'), visit('ana', monday, '09:30', '10:30'), visit('ana', monday, '13:30', '14:30')],
      blocks: [{ practitioner_id: 'ana', room_id: null, starts_at: at(monday, '18:00'), ends_at: at(monday, '19:00') }],
    })
    // 5 h + 3 h, less the 1 h block = 7 h, plus the half hour of the 13:30 visit
    // that runs past 14:00; booked 9:00-10:30 and 13:30-14:30 = 2 h 30.
    expect(mon).toMatchObject({ capacityMin: 450, bookedMin: 150, freeMin: 300, visits: 3 })
    expect(mon!.share).toBeCloseTo(150 / 450)
    // Tuesday is her day off.
    expect(tue).toMatchObject({ capacityMin: 0, bookedMin: 0, share: null })
  })

  it('takes the clinic’s hours for someone who never set any, and a clinic closure off everyone', () => {
    const [mon] = monthOccupancy({
      days: [monday],
      practitioners: [ana, luis],
      clinicHours: { mon: [['10:00', '18:00']] },
      appointments: [visit('luis', monday, '10:00', '12:00')],
      blocks: [
        { practitioner_id: null, room_id: null, starts_at: at(monday, '09:00'), ends_at: at(monday, '11:00') },
        // A room's block closes a room, not a person.
        { practitioner_id: null, room_id: 'r1', starts_at: at(monday, '16:00'), ends_at: at(monday, '18:00') },
      ],
    })
    // Ana: her own 8 h less the 9-11 closure = 6 h. Luis: the clinic's 10-18
    // less 10-11 = 7 h, and the hour he saw someone in the closure anyway.
    expect(mon!.capacityMin).toBe(360 + 420 + 60)
    expect(mon!.bookedMin).toBe(120)
  })

  it('counts visits outside someone’s hours as time they worked', () => {
    // Afternoon hours on Thursdays, patients seen in the morning instead.
    const thursday = new Date(2026, 9, 1) // Thu 1 Oct 2026
    const later = new Date(2026, 9, 15)
    const eva = { id: 'eva', business_hours: { thu: [['15:00', '20:00']] as [string, string][] } }
    const [day, blocked] = monthOccupancy({
      days: [thursday, later],
      practitioners: [eva],
      clinicHours: null,
      appointments: [
        visit('eva', thursday, '09:30', '10:30'),
        visit('eva', thursday, '11:30', '12:30'),
        visit('eva', thursday, '12:30', '13:30'),
        visit('eva', thursday, '13:30', '14:00'),
        visit('eva', later, '10:00', '11:00'),
      ],
      // The afternoon blocked off: without the morning visit this is a closed day.
      blocks: [{ practitioner_id: 'eva', room_id: null, starts_at: at(later, '15:00'), ends_at: at(later, '20:00') }],
    })
    // Never 0 % beside four visits: 5 h of hours plus the 3 h 30 worked.
    expect(day).toMatchObject({ capacityMin: 510, bookedMin: 210, freeMin: 300, visits: 4 })
    expect(day!.share).toBeCloseTo(210 / 510)
    // Not "Closed" with a visit on it.
    expect(blocked).toMatchObject({ capacityMin: 60, bookedMin: 60, freeMin: 0, share: 1, visits: 1 })
  })

  it('has no percentage when nobody configured hours, and still counts the visits', () => {
    const [mon] = monthOccupancy({ days: [monday], practitioners: [luis], clinicHours: null, appointments: [visit('luis', monday, '10:00', '11:00')], blocks: [] })
    expect(mon).toMatchObject({ capacityMin: null, freeMin: null, share: null, bookedMin: 60, visits: 1 })
  })

  it('labels hours', () => {
    expect(hoursLabel(45)).toBe('45 min')
    expect(hoursLabel(210)).toBe('3 h 30')
    expect(hoursLabel(120)).toBe('2 h')
  })
})
