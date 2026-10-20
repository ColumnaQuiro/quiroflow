import { describe, expect, it } from 'vitest'
import { patientWidgetSnapshot, widgetLinkPath, widgetSnapshotFromRpc, type HomeWidgetRpc } from '../../utils/homeWidget'

// The home-screen widgets' snapshot (utils/homeWidget.ts): what the native
// widget lays out, written in the person's language and the clinic's clock.
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

describe('widgetSnapshotFromRpc', () => {
  const day: HomeWidgetRpc['day'] = {
    scope: 'clinic',
    total: 4,
    done: 1,
    arrived: 1,
    next: [
      { id: 'a1', starts_at: '2026-10-20T07:55:00Z', first_name: 'Bruno', last_name: 'Dos', type_name: 'Ajuste', practitioner: 'Lucía Ferrer Gil', arrived: true },
      { id: 'a2', starts_at: '2026-10-20T08:30:00Z', first_name: 'Carla', last_name: 'Tres', practitioner: 'Sergio', arrived: false },
    ],
  }
  const clinic: HomeWidgetRpc = {
    view: 'clinic',
    who: 'Ana Dueña',
    clinic: 'Clínica Demo',
    today: '2026-10-20',
    time_zone: 'Europe/Madrid',
    figures: { payments_cents: 1864000, visits_done: 14, visits_total: 22, no_shows: 1, bonos_count: 9, bonos_cents: 243000 },
    day,
  }

  it("gives an owner the clinic's month in whole euros, in Spanish", () => {
    const s = widgetSnapshotFromRpc(clinic, { lang: 'es' }, NOW)
    expect(s?.kind).toBe('clinic')
    if (s?.kind !== 'clinic') return
    expect(s.title).toBe('Clínica Demo · octubre')
    expect(s.money).toMatchObject({ smallLabel: 'Cobrado · octubre', value: '18.640\u00a0€', range: '1–20 oct', link: 'quiroflow://widget/numbers?period=month' })
    expect(s.patients).toMatchObject({ done: 14, total: 22, note: '8 por atender · 1 no vino', link: 'quiroflow://widget/calendar?scope=clinic' })
    expect(s.bonos).toMatchObject({ smallLabel: 'Bonos · oct', count: 9, value: '2430\u00a0€ en ventas' })
    expect(s.labels.minAgo).toBe('hace %d min')
    expect(s.updatedTime).toBe('10:00')
    expect(s.date).toBe('2026-10-20')
  })

  it('writes English, and masks the money in privacy mode', () => {
    const s = widgetSnapshotFromRpc(clinic, { lang: 'en', privacy: true }, NOW)
    if (s?.kind !== 'clinic') throw new Error('expected clinic')
    expect(s.money).toMatchObject({ smallLabel: 'Taken · October', value: '€••••', range: '1–20 Oct' })
    expect(s.patients.note).toBe('8 still to see · 1 no-show')
    expect(s.bonos.value).toBe('€•••• in sales')
    expect(s.list?.next.map((n) => n.name)).toEqual(['B. D.', 'C. T.'])
  })

  it("gives the front desk the clinic's day, with whom each visit is, and no money", () => {
    const s = widgetSnapshotFromRpc({ view: 'desk', who: 'Recepción', today: '2026-10-20', time_zone: 'Europe/Madrid', day }, { lang: 'es' }, NOW)
    expect(s?.kind).toBe('staff')
    if (s?.kind !== 'staff') return
    expect(s).toMatchObject({ scope: 'clinic', title: 'Hoy en la clínica', remaining: 3, done: 1, arrived: 1, link: 'quiroflow://widget/calendar?scope=clinic' })
    expect(s.next.map((n) => [n.time, n.name, n.with, n.link])).toEqual([
      ['09:55', 'Bruno Dos', 'Lucía F.', 'quiroflow://widget/calendar/a1'],
      ['10:30', 'Carla Tres', 'Sergio', 'quiroflow://widget/calendar/a2'],
    ])
    expect(JSON.stringify(s)).not.toMatch(/€/)
  })

  it("gives a practitioner their own day, titled with their name", () => {
    const s = widgetSnapshotFromRpc({ view: 'day', who: 'Lucía Ferrer', today: '2026-10-20', time_zone: 'Europe/Madrid', day: { ...day, scope: 'own' } }, { lang: 'es' }, NOW)
    if (s?.kind !== 'staff') throw new Error('expected staff')
    expect(s.title).toBe('Hoy · Lucía Ferrer')
    expect(s.link).toBe('quiroflow://widget/my-day')
    expect(s.next.every((n) => n.with === null)).toBe(true)
  })

  it('says nothing when the database has nothing for this person', () => {
    expect(widgetSnapshotFromRpc({ view: 'none', who: 'X', today: '2026-10-20', time_zone: 'Europe/Madrid' }, { lang: 'es' }, NOW)).toBeNull()
  })
})

describe('widgetLinkPath', () => {
  it('opens the screens the widget links to', () => {
    expect(widgetLinkPath('quiroflow://widget/numbers?period=month')).toBe('/numbers?period=month')
    expect(widgetLinkPath('quiroflow://widget/calendar?scope=clinic')).toBe('/calendar?scope=clinic')
    expect(widgetLinkPath('quiroflow://widget/my-day')).toBe('/my-day')
    expect(widgetLinkPath('quiroflow://widget/calendar/0b6f8c1e-6a52-4c3e-9d8e-2f1a7b9c0d11')).toBe('/calendar/0b6f8c1e-6a52-4c3e-9d8e-2f1a7b9c0d11')
  })
  it('opens nothing else', () => {
    expect(widgetLinkPath('quiroflow://widget/settings')).toBeNull()
    expect(widgetLinkPath('quiroflow://widget/calendar?scope=clinic&next=https://evil.example')).toBeNull()
    expect(widgetLinkPath('quiroflow://widget//evil.example')).toBeNull()
    expect(widgetLinkPath('https://app.quiroflow.com/my-day')).toBeNull()
    expect(widgetLinkPath(null)).toBeNull()
  })
})
