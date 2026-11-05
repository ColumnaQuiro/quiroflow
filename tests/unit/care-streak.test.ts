import { describe, it, expect } from 'vitest'
import { achievements, addDays, careStreak, dayState, isoWeekday, thisWeek } from '../../utils/careStreak'

// Cuidarme's streak: one missed day a week is a "día libre" and does not
// break it; a second one in the same week does; today is not a miss while it
// is still today.

const days = (from: string, n: number, skip: string[] = []) => new Set(Array.from({ length: n }, (_, i) => addDays(from, i)).filter((d) => !skip.includes(d)))

describe('care streak', () => {
  it('knows Monday from Sunday', () => {
    expect(isoWeekday('2026-11-02')).toBe(1)
    expect(isoWeekday('2026-11-08')).toBe(7)
    expect(thisWeek('2026-11-05')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
  })

  it('counts done days up to today, and up to yesterday while today is still open', () => {
    expect(careStreak(days('2026-11-01', 5), '2026-11-05').current).toBe(5)
    expect(careStreak(days('2026-11-01', 4), '2026-11-05').current).toBe(4)
  })

  it('lets one missed day a week go, as a free day', () => {
    // Mon 9 .. Fri 20 November with Wed 18 missed: 11 done, the 18th free.
    const active = days('2026-11-09', 12, ['2026-11-18'])
    const s = careStreak(active, '2026-11-20')
    expect(s.current).toBe(11)
    expect(s.free).toEqual(['2026-11-18'])
    expect(dayState('2026-11-18', '2026-11-20', active, s.free)).toBe('free')
  })

  it('breaks on a second missed day in the same week', () => {
    const active = days('2026-11-09', 12, ['2026-11-17', '2026-11-18'])
    const s = careStreak(active, '2026-11-20')
    // Thu 19 and Fri 20 since; before that Mon 9 to Mon 16.
    expect(s.current).toBe(2)
    expect(s.best).toBe(8)
  })

  it('allows a free day in each of two weeks', () => {
    const active = days('2026-11-02', 14, ['2026-11-04', '2026-11-11'])
    expect(careStreak(active, '2026-11-15').current).toBe(12)
  })

  it('does not call the days before a streak began free', () => {
    const active = days('2026-11-04', 2)
    const s = careStreak(active, '2026-11-05')
    expect(s.free).toEqual([])
    expect(dayState('2026-11-03', '2026-11-05', active, s.free)).toBe('missed')
  })

  it('is nothing at all with nothing done', () => {
    expect(careStreak(new Set(), '2026-11-05')).toEqual({ current: 0, free: [], best: 0 })
  })
})

describe('achievements', () => {
  const base = { videosWatched: 0, sentTotal: 0, sentRead: 0, painFirst: null, painLatest: null }

  it('dates the first full week and shows how far 30 days is', () => {
    const list = achievements({ ...base, active: days('2026-11-02', 12), today: '2026-11-13' })
    const week = list.find((a) => a.key === 'primera_semana')!
    expect(week.done).toBe(true)
    expect(week.on).toBe('2026-11-08')
    const month = list.find((a) => a.key === 'treinta_dias')!
    expect(month.done).toBe(false)
    expect(month.progress).toEqual([12, 30])
    expect(month.detail).toBe('12 de 30')
  })

  it('says pain halved only when it has', () => {
    const halved = achievements({ ...base, active: new Set(), today: '2026-11-13', painFirst: 7, painLatest: 3, painLatestOn: '2026-11-12' }).find((a) => a.key === 'dolor_mitad')!
    expect(halved.done).toBe(true)
    expect(halved.detail).toBe('De 7 a 3')
    const notYet = achievements({ ...base, active: new Set(), today: '2026-11-13', painFirst: 7, painLatest: 4 }).find((a) => a.key === 'dolor_mitad')!
    expect(notYet.done).toBe(false)
    // No pain recorded: no such achievement to chase.
    expect(achievements({ ...base, active: new Set(), today: '2026-11-13' }).some((a) => a.key === 'dolor_mitad')).toBe(false)
  })

  it('counts a week of every habit only for seven days running', () => {
    const six = achievements({ ...base, active: new Set(), today: '2026-11-13', fullHabitDays: days('2026-11-07', 6) }).find((a) => a.key === 'habitos_semana')!
    expect(six.done).toBe(false)
    expect(six.progress).toEqual([6, 7])
    const seven = achievements({ ...base, active: new Set(), today: '2026-11-13', fullHabitDays: days('2026-11-07', 7) }).find((a) => a.key === 'habitos_semana')!
    expect(seven.done).toBe(true)
    expect(seven.on).toBe('2026-11-13')
  })
})
