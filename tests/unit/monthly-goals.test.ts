import { describe, expect, it } from 'vitest'
import { goalPace, goalValue, monthOf, nextMonthStart } from '../../utils/monthlyGoals'
import { digestEmailHtml, digestWeek } from '../../utils/weeklyDigest'

describe('goalPace', () => {
  it('is done once reached, behind under 90 % of an even month, on track otherwise', () => {
    expect(goalPace({ actual: 20, target: 20 }, 0.3)).toBe('done')
    // Half the month gone: an even month would be at 10 of 20; 9 is the 90 % line.
    expect(goalPace({ actual: 9, target: 20 }, 0.5)).toBe('on_track')
    expect(goalPace({ actual: 8, target: 20 }, 0.5)).toBe('behind')
    // Day one is never behind.
    expect(goalPace({ actual: 0, target: 20 }, 0)).toBe('on_track')
  })
})

describe('month helpers', () => {
  it('names the month and the start of the next, across a year end', () => {
    expect(monthOf('2026-10-15')).toBe('2026-10')
    expect(nextMonthStart('2026-10')).toBe('2026-11-01')
    expect(nextMonthStart('2026-12')).toBe('2027-01-01')
    expect(goalValue('collected_cents', 1250000)).toContain('12.500')
    expect(goalValue('visits', 140)).toBe('140')
  })
})

describe('the Monday summary with goals', () => {
  it('lists this month’s goals with where each stands', () => {
    const week = digestWeek({ payments: [], invoicedCents: 0, visits: [], newPatients: 0 })
    const html = digestEmailHtml({
      clinicName: 'Clínica Demo', weekLabel: '5–11 oct', thisWeek: week, lastWeek: week, owedCents: 0, nextWeekBooked: 0, methodName: (k) => k, origin: 'https://app.quiroflow.com',
      goals: { monthLabel: 'octubre', elapsed: 0.5, items: [{ metric: 'new_patients', target: 20, actual: 6 }, { metric: 'visits', target: 200, actual: 120 }] },
    })
    expect(html).toContain('Objetivos de octubre')
    expect(html).toContain('Pacientes nuevos')
    expect(html).toContain('6 / 20')
    expect(html).toContain('Por detrás')
    expect(html).toContain('En camino')
  })
})
