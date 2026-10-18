import { describe, expect, it } from 'vitest'
import { patientWidgetSnapshot, staffWidgetSnapshot } from '../../utils/homeWidget'

// The home-screen widgets' snapshot (utils/homeWidget.ts): what the native
// widget lays out, written in Spanish and the clinic's clock.
const NOW = new Date('2026-10-20T08:00:00Z') // 10:00 in Madrid

describe('patientWidgetSnapshot', () => {
  it('has the next visit as the patient reads it, and the bono they are working through', () => {
    const s = patientWidgetSnapshot(
      {
        next: { starts_at: '2026-10-23T08:30:00Z', appointment_types: { name: 'Ajuste' }, team_members: { full_name: 'Dra. Marta Ruiz' } },
        packages: [
          { package_name: 'Bono 5', sessions_total: 5, sessions_used: 5 },
          { package_name: 'Bono 10', sessions_total: 10, sessions_used: 4 },
        ],
        clinic: 'Clínica Demo',
        timeZone: 'Europe/Madrid',
      },
      NOW,
    )
    expect(s.next).toEqual({ at: '2026-10-23T08:30:00.000Z', label: 'vie, 23 oct · 10:30', what: 'Ajuste', who: 'Dra. Marta Ruiz' })
    expect(s.bono).toEqual({ name: 'Bono 10', left: 6, total: 10 })
    expect(s.updatedAt).toBe(NOW.toISOString())
  })
  it('says nothing about what they do not have', () => {
    const s = patientWidgetSnapshot({ next: null, packages: [], clinic: null, timeZone: 'Europe/Madrid' }, NOW)
    expect(s.next).toBeNull()
    expect(s.bono).toBeNull()
  })
})

describe('staffWidgetSnapshot', () => {
  const appts = [
    { starts_at: '2026-10-20T07:00:00Z', status: 'completed', checked_in_at: '2026-10-20T06:55:00Z', patients: { first_name: 'Ana', last_name: 'Uno' }, appointment_types: { name: 'Ajuste' } },
    { starts_at: '2026-10-20T07:55:00Z', status: 'booked', checked_in_at: '2026-10-20T07:50:00Z', patients: { first_name: 'Bruno', last_name: 'Dos' }, appointment_types: { name: 'Ajuste' } },
    { starts_at: '2026-10-20T08:30:00Z', status: 'booked', checked_in_at: null, patients: { first_name: 'Carla', last_name: 'Tres' }, appointment_types: { name: 'Revisión' } },
    { starts_at: '2026-10-20T09:00:00Z', status: 'cancelled', checked_in_at: null, patients: { first_name: 'Dora', last_name: 'Cuatro' }, appointment_types: null },
  ]
  it('counts the day and lists what is still to come, someone just arrived first', () => {
    const s = staffWidgetSnapshot({ who: 'Dra. Marta Ruiz', appointments: appts, timeZone: 'Europe/Madrid' }, NOW)
    expect(s).toMatchObject({ who: 'Dra. Marta Ruiz', remaining: 2, done: 1, arrived: 1 })
    expect(s.next.map((n) => [n.time, n.name, n.arrived])).toEqual([
      ['09:55', 'Bruno Dos', true],
      ['10:30', 'Carla Tres', false],
    ])
  })
  it('shows initials in privacy mode', () => {
    const s = staffWidgetSnapshot({ who: 'X', appointments: appts, timeZone: 'Europe/Madrid', privacy: true }, NOW)
    expect(s.next.map((n) => n.name)).toEqual(['B. D.', 'C. T.'])
  })
})
