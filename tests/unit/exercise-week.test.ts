import { describe, expect, it } from 'vitest'
import { exerciseWeek, deviceDay } from '../../utils/exerciseWeek'

describe('the week strip under a home exercise', () => {
  const thursday = new Date(2026, 9, 8, 21, 30) // Thu 8 Oct 2026, evening

  it('is the last seven days ending today, oldest first', () => {
    const week = exerciseWeek([], thursday)
    expect(week.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'])
    expect(week.map((d) => d.initial).join('')).toBe('VSDLMXJ')
    expect(week.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-10-08'])
  })

  it('marks the days the patient logged, ignoring older ones', () => {
    const week = exerciseWeek(['2026-10-08', '2026-10-05', '2026-09-20'], thursday)
    expect(week.filter((d) => d.done).map((d) => d.date)).toEqual(['2026-10-05', '2026-10-08'])
  })

  it('uses the device calendar day, not UTC', () => {
    expect(deviceDay(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08')
  })
})
