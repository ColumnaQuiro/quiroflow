import { describe, expect, it } from 'vitest'
import { DAY_MS, needsVisitHistory, newestAt, noWhatsAppSentMatches, visitHistoryMatches } from '../../utils/automationAudience'

// The visit-history and "nothing sent lately" filters a recall segment is
// built from, as both evaluators (per patient at enrolment, in bulk for the
// live count) read them.

const now = Date.parse('2026-10-18T10:00:00Z')
const daysAgo = (n: number) => now - n * DAY_MS

describe('visit-history filters', () => {
  it('reads a band between "before" (exclusive) and "within" (inclusive)', () => {
    const band = { last_visit_before_days: 90, last_visit_within_days: 180 }
    expect(visitHistoryMatches(band, 3, daysAgo(120), now)).toBe(true)
    expect(visitHistoryMatches(band, 3, daysAgo(180), now)).toBe(true)
    expect(visitHistoryMatches(band, 3, daysAgo(90), now)).toBe(false)
    expect(visitHistoryMatches(band, 3, daysAgo(89), now)).toBe(false)
    expect(visitHistoryMatches(band, 3, daysAgo(181), now)).toBe(false)
  })

  it('never takes the same person into two bands split at the same day', () => {
    const threeToSix = { last_visit_before_days: 90, last_visit_within_days: 180 }
    const sixToTwelve = { last_visit_before_days: 180, last_visit_within_days: 365 }
    for (const at of [daysAgo(180), daysAgo(180) - 1, daysAgo(180) + 1]) {
      expect(visitHistoryMatches(threeToSix, 2, at, now) && visitHistoryMatches(sixToTwelve, 2, at, now)).toBe(false)
    }
  })

  it('needs a completed visit for either edge, as "lapsed" implies one', () => {
    expect(visitHistoryMatches({ last_visit_before_days: 30 }, 0, null, now)).toBe(false)
    expect(visitHistoryMatches({ last_visit_within_days: 30 }, 0, null, now)).toBe(false)
    expect(visitHistoryMatches({ min_visits: 0 }, 0, null, now)).toBe(true)
  })

  it('counts visits as a range, or exactly', () => {
    expect(visitHistoryMatches({ min_visits: 2 }, 2, daysAgo(1), now)).toBe(true)
    expect(visitHistoryMatches({ min_visits: 2 }, 1, daysAgo(1), now)).toBe(false)
    expect(visitHistoryMatches({ max_visits: 1 }, 1, daysAgo(1), now)).toBe(true)
    expect(visitHistoryMatches({ max_visits: 1 }, 2, daysAgo(1), now)).toBe(false)
    expect(visitHistoryMatches({ min_visits: 1, max_visits: 1 }, 1, daysAgo(1), now)).toBe(true)
    expect(visitHistoryMatches({ total_visits: 3 }, 3, daysAgo(1), now)).toBe(true)
    expect(visitHistoryMatches({ total_visits: 3 }, 4, daysAgo(1), now)).toBe(false)
  })

  it('ignores a filter that is absent, null or not a usable number', () => {
    expect(visitHistoryMatches({}, 0, null, now)).toBe(true)
    expect(visitHistoryMatches({ last_visit_before_days: null, min_visits: null }, 0, null, now)).toBe(true)
    expect(visitHistoryMatches({ last_visit_before_days: 0, last_visit_within_days: -5 }, 0, null, now)).toBe(true)
    expect(needsVisitHistory({})).toBe(false)
    expect(needsVisitHistory({ last_visit_before_days: 0 })).toBe(false)
    expect(needsVisitHistory({ max_visits: 0 })).toBe(true)
    expect(needsVisitHistory({ last_visit_within_days: 120 })).toBe(true)
  })
})

describe('no WhatsApp sent in N days', () => {
  it('clears someone never written to, and someone written to long enough ago', () => {
    expect(noWhatsAppSentMatches(30, null, now)).toBe(true)
    expect(noWhatsAppSentMatches(30, daysAgo(31), now)).toBe(true)
    expect(noWhatsAppSentMatches(30, daysAgo(30), now)).toBe(false)
    expect(noWhatsAppSentMatches(30, daysAgo(2), now)).toBe(false)
  })

  it('is off without a positive number of days', () => {
    expect(noWhatsAppSentMatches(undefined, daysAgo(1), now)).toBe(true)
    expect(noWhatsAppSentMatches(0, daysAgo(1), now)).toBe(true)
  })

  it('takes the newest of several timestamps, skipping blanks', () => {
    expect(newestAt([{ at: '2026-01-01T00:00:00Z' }, { at: null }, { at: '2026-03-01T00:00:00Z' }])).toBe(Date.parse('2026-03-01T00:00:00Z'))
    expect(newestAt([{ at: undefined }])).toBeNull()
    expect(newestAt([])).toBeNull()
  })
})
