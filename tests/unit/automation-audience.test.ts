import { describe, expect, it } from 'vitest'
import { DAY_MS, needsVisitHistory, newestAt, noWhatsAppSentMatches, recallParked, respectsRecallQueue, visitHistoryMatches, visitTypeIdsOf } from '../../utils/automationAudience'
import { FILTERS, FILTER_KEYS, defaultFilterValue, filtersInUse } from '../../utils/automationCatalog'

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

describe('visit type ("Tipo de visita") on a group of patients', () => {
  it('needs at least one completed visit of the chosen types, counted by the caller', () => {
    const f = { visit_type_ids: ['massage'] }
    expect(needsVisitHistory(f)).toBe(true)
    expect(visitHistoryMatches(f, 0, null, now)).toBe(false)
    expect(visitHistoryMatches(f, 1, daysAgo(10), now)).toBe(true)
    // With a band, the band is read off the visits of that type.
    expect(visitHistoryMatches({ ...f, last_visit_before_days: 90 }, 2, daysAgo(10), now)).toBe(false)
    expect(visitHistoryMatches({ ...f, last_visit_before_days: 90 }, 2, daysAgo(100), now)).toBe(true)
  })

  it('reads an empty or malformed list as any type, as every list filter does', () => {
    expect(visitTypeIdsOf({ visit_type_ids: [] })).toBeNull()
    expect(visitTypeIdsOf({ visit_type_ids: ['', 3] })).toBeNull()
    expect(visitTypeIdsOf({})).toBeNull()
    expect(needsVisitHistory({ visit_type_ids: [] })).toBe(false)
    expect(visitHistoryMatches({ visit_type_ids: [] }, 0, null, now)).toBe(true)
    expect(visitTypeIdsOf({ visit_type_ids: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('is offered on a group, owns only its own key, and stays on screen while empty', () => {
    const def = FILTERS.find((f) => f.key === 'visit_types')!
    expect(def.segment).toBe(true)
    expect(def.appointment).toBeFalsy()
    expect(FILTER_KEYS.visit_types).toEqual(['visit_type_ids'])
    expect(filtersInUse(defaultFilterValue('visit_types'))).toEqual(['visit_types'])
    // Not mistaken for the appointment's own type, nor that for it.
    expect(filtersInUse({ appointment_type_ids: ['x'] })).toEqual(['appointment_types'])
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

describe('the Recalls queue, as a recall segment reads it', () => {
  const today = '2026-10-18'
  const active = { recall_status: 'active', recall_snoozed_until: null, recall_dismissed_at: null }

  it('applies to non-marketing rules keyed on "last visit more than N days ago"', () => {
    expect(respectsRecallQueue({ last_visit_before_days: 90, last_visit_within_days: 180 }, false)).toBe(true)
    expect(respectsRecallQueue({ last_visit_before_days: 90 }, true)).toBe(false)
    expect(respectsRecallQueue({ last_visit_within_days: 30 }, false)).toBe(false)
    expect(respectsRecallQueue({}, false)).toBe(false)
    expect(respectsRecallQueue(null, false)).toBe(false)
  })

  it('leaves nobody out who is simply in the queue', () => {
    expect(recallParked(active, daysAgo(120), today)).toBe(false)
    expect(recallParked(active, null, today)).toBe(false)
  })

  it('leaves out the snoozed until the day the snooze ends', () => {
    expect(recallParked({ ...active, recall_snoozed_until: '2026-12-17' }, daysAgo(120), today)).toBe(true)
    expect(recallParked({ ...active, recall_snoozed_until: '2026-10-19' }, daysAgo(120), today)).toBe(true)
    // The view's "snoozed_until <= current_date": back in on that day itself.
    expect(recallParked({ ...active, recall_snoozed_until: today }, daysAgo(120), today)).toBe(false)
    expect(recallParked({ ...active, recall_snoozed_until: '2026-09-01' }, daysAgo(120), today)).toBe(false)
  })

  it('leaves out the dismissed who have not been seen since', () => {
    const dismissed = { ...active, recall_status: 'dismissed', recall_dismissed_at: new Date(daysAgo(30)).toISOString() }
    expect(recallParked(dismissed, daysAgo(120), today)).toBe(true)
    expect(recallParked(dismissed, null, today)).toBe(true)
    // A dismissal with no date never lifts, as in recall_candidates.
    expect(recallParked({ ...dismissed, recall_dismissed_at: null }, daysAgo(1), today)).toBe(true)
  })

  it('takes the dismissed back once they come for a visit after it', () => {
    const dismissed = { ...active, recall_status: 'dismissed', recall_dismissed_at: new Date(daysAgo(200)).toISOString() }
    expect(recallParked(dismissed, daysAgo(120), today)).toBe(false)
    expect(recallParked(dismissed, daysAgo(200), today)).toBe(true)
    // Came back, but then asked for later: the snooze still holds.
    expect(recallParked({ ...dismissed, recall_snoozed_until: '2026-11-01' }, daysAgo(120), today)).toBe(true)
  })
})
