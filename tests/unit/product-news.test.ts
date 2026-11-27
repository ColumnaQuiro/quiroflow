import { describe, expect, it } from 'vitest'
import { NEWS_AREAS, PRODUCT_NEWS, newsWeekStart, unreadNews, type NewsEntry } from '../../utils/productNews'

const entry = (id: string, date: string): NewsEntry => ({ id, date, kind: 'improvement', area: 'calendar', title: [id, id] })

describe('productNews', () => {
  it('weeks start on Monday', () => {
    expect(newsWeekStart('2026-11-23')).toBe('2026-11-23') // Monday
    expect(newsWeekStart('2026-11-26')).toBe('2026-11-23') // Thursday
    expect(newsWeekStart('2026-11-29')).toBe('2026-11-23') // Sunday
    expect(newsWeekStart('2026-11-30')).toBe('2026-11-30')
  })

  it('counts as unread only what is newer than the last entry seen', () => {
    const list = [entry('c', '2026-11-26'), entry('b', '2026-11-20'), entry('a', '2026-11-01')]
    expect(unreadNews(list, '2026-11-20', '2026-11-27').map((e) => e.id)).toEqual(['c'])
    expect(unreadNews(list, '2026-11-26', '2026-11-27')).toEqual([])
  })

  it('shows someone who never opened it only the last fortnight', () => {
    const list = [entry('c', '2026-11-26'), entry('b', '2026-11-20'), entry('a', '2026-11-01')]
    expect(unreadNews(list, null, '2026-11-27').map((e) => e.id)).toEqual(['c', 'b'])
  })

  it('is sorted newest first, with unique ids and well-formed entries', () => {
    const dates = PRODUCT_NEWS.map((e) => e.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    expect(new Set(PRODUCT_NEWS.map((e) => e.id)).size).toBe(PRODUCT_NEWS.length)
    for (const e of PRODUCT_NEWS) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(NEWS_AREAS[e.area], e.id).toBeDefined()
      expect(e.title.every(Boolean), e.id).toBe(true)
      // A fix is one line under the week's fold: nothing to open, nowhere to go.
      if (e.kind === 'fix') expect(e.where ?? e.steps ?? e.featured, e.id).toBeUndefined()
      if (e.where) expect(e.where.to, e.id).toMatch(/^\//)
    }
  })

  it('features at most two entries a week', () => {
    const perWeek = new Map<string, number>()
    for (const e of PRODUCT_NEWS.filter((x) => x.featured)) perWeek.set(newsWeekStart(e.date), (perWeek.get(newsWeekStart(e.date)) ?? 0) + 1)
    for (const [week, n] of perWeek) expect(n, week).toBeLessThanOrEqual(2)
  })
})
