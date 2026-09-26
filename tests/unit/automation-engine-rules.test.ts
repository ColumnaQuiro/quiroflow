import { describe, expect, it } from 'vitest'
import { conditionHolds, evaluateBranch } from '../../utils/automationConditions'
import { lastScheduledOccurrence, nextAllowedSendTime, segmentIsDue } from '../../utils/automationTiming'

// The pure halves of the automation engine: when a message may go out (quiet
// hours), when a scheduled segment runs, and which way a branch goes.

const MADRID = 'Europe/Madrid'

describe('quiet hours', () => {
  const weekdays = { from: '10:00', to: '20:00', days: [1, 2, 3, 4, 5, 6] }

  it('lets a send inside the window through unchanged', () => {
    // Wednesday 30 Sep 2026, 12:00 in Madrid (CEST, UTC+2).
    const at = new Date('2026-09-30T10:00:00Z')
    expect(nextAllowedSendTime(at, weekdays, MADRID).toISOString()).toBe(at.toISOString())
  })

  it('holds an early-morning send until the window opens the same day', () => {
    const at = new Date('2026-09-30T04:00:00Z') // 06:00 Madrid
    expect(nextAllowedSendTime(at, weekdays, MADRID).toISOString()).toBe('2026-09-30T08:00:00.000Z')
  })

  it('holds an evening send until the next morning', () => {
    const at = new Date('2026-09-30T19:30:00Z') // 21:30 Madrid
    expect(nextAllowedSendTime(at, weekdays, MADRID).toISOString()).toBe('2026-10-01T08:00:00.000Z')
  })

  it('skips a day the window does not cover', () => {
    const at = new Date('2026-10-03T19:00:00Z') // Saturday 21:00 -> Monday 10:00
    expect(nextAllowedSendTime(at, weekdays, MADRID).toISOString()).toBe('2026-10-05T08:00:00.000Z')
  })

  it('reads the window in the clinic zone across the clock change', () => {
    // Sunday 25 Oct 2026 is the switch to CET; Monday 10:00 is then UTC+1.
    const at = new Date('2026-10-25T12:00:00Z')
    expect(nextAllowedSendTime(at, weekdays, MADRID).toISOString()).toBe('2026-10-26T09:00:00.000Z')
  })

  it('does nothing without valid quiet hours', () => {
    const at = new Date('2026-09-30T02:00:00Z')
    expect(nextAllowedSendTime(at, null, MADRID)).toBe(at)
    expect(nextAllowedSendTime(at, { from: '20:00', to: '10:00' }, MADRID)).toBe(at)
    expect(nextAllowedSendTime(at, { from: 'x', to: '10:00' }, MADRID)).toBe(at)
  })
})

describe('segment schedules', () => {
  const created = new Date('2026-09-01T00:00:00Z')

  it('runs a daily segment once per day, after its time', () => {
    const schedule = { kind: 'daily' as const, time: '09:00' }
    const before = new Date('2026-09-30T06:30:00Z') // 08:30 Madrid
    const after = new Date('2026-09-30T07:05:00Z') // 09:05 Madrid
    expect(lastScheduledOccurrence(schedule, after, MADRID, created)?.toISOString()).toBe('2026-09-30T07:00:00.000Z')
    expect(segmentIsDue(schedule, new Date('2026-09-29T07:01:00Z'), created, before, MADRID)).toBe(false)
    expect(segmentIsDue(schedule, new Date('2026-09-29T07:01:00Z'), created, after, MADRID)).toBe(true)
    expect(segmentIsDue(schedule, new Date('2026-09-30T07:01:00Z'), created, after, MADRID)).toBe(false)
  })

  it('does not run for an occurrence from before the rule existed', () => {
    const schedule = { kind: 'daily' as const, time: '09:00' }
    const savedAfterNine = new Date('2026-09-30T13:00:00Z')
    expect(segmentIsDue(schedule, null, savedAfterNine, new Date('2026-09-30T14:00:00Z'), MADRID)).toBe(false)
    expect(segmentIsDue(schedule, null, savedAfterNine, new Date('2026-10-01T07:05:00Z'), MADRID)).toBe(true)
  })

  it('runs a weekly segment on its weekday only', () => {
    const schedule = { kind: 'weekly' as const, weekday: 1, time: '10:00' } // Mondays
    const monday = new Date('2026-10-05T08:30:00Z') // Monday 10:30 Madrid
    const tuesday = new Date('2026-10-06T08:30:00Z')
    expect(segmentIsDue(schedule, new Date('2026-09-28T08:05:00Z'), created, monday, MADRID)).toBe(true)
    expect(segmentIsDue(schedule, new Date('2026-10-05T08:05:00Z'), created, tuesday, MADRID)).toBe(false)
  })

  it('runs a one-off segment once, at its start', () => {
    const schedule = { kind: 'once' as const, starts_at: '2026-10-01T08:00:00Z' }
    expect(segmentIsDue(schedule, null, created, new Date('2026-09-30T08:00:00Z'), MADRID)).toBe(false)
    expect(segmentIsDue(schedule, null, created, new Date('2026-10-01T08:00:01Z'), MADRID)).toBe(true)
    expect(segmentIsDue(schedule, new Date('2026-10-01T08:15:00Z'), created, new Date('2026-10-02T08:00:00Z'), MADRID)).toBe(false)
  })

  it('is never due without a schedule', () => {
    expect(segmentIsDue(undefined, null, created, new Date(), MADRID)).toBe(false)
  })
})

describe('branch conditions', () => {
  it('matches tags the way tag_contains does: substring, any case', () => {
    expect(conditionHolds(['Cliente VIP|10x'], 'contains', 'vip')).toBe(true)
    expect(conditionHolds(['normal'], 'contains', 'vip')).toBe(false)
    expect(conditionHolds(['normal'], 'not_contains', 'vip')).toBe(true)
  })

  it('compares numbers, and refuses to compare what is missing', () => {
    expect(conditionHolds(3, 'gte', 3)).toBe(true)
    expect(conditionHolds(2, 'gt', 3)).toBe(false)
    expect(conditionHolds(undefined, 'lt', 3)).toBe(false)
    expect(conditionHolds(-500, 'lt', 0)).toBe(true)
  })

  it('reads booleans strictly', () => {
    expect(conditionHolds(true, 'is_true', undefined)).toBe(true)
    expect(conditionHolds(undefined, 'is_false', undefined)).toBe(false)
    expect(conditionHolds(false, 'is', false)).toBe(true)
  })

  it('matches membership in a list', () => {
    expect(conditionHolds('booked', 'in', ['booked', 'showed'])).toBe(true)
    expect(conditionHolds('lost', 'not_in', ['booked', 'showed'])).toBe(true)
    expect(conditionHolds(null, 'not_in', ['booked'])).toBe(false)
  })

  it('combines with all / any, and a branch that asks nothing is yes', () => {
    const facts = { tags: ['vip'], total_visits: 1 }
    const conditions = [
      { field: 'tags', op: 'contains' as const, value: 'vip' },
      { field: 'total_visits', op: 'gte' as const, value: 3 },
    ]
    expect(evaluateBranch({ match: 'all', conditions }, facts)).toBe(false)
    expect(evaluateBranch({ match: 'any', conditions }, facts)).toBe(true)
    expect(evaluateBranch({ conditions: [] }, facts)).toBe(true)
    expect(evaluateBranch({ conditions: [{ field: 'nonsense', op: 'is', value: 'x' }] }, facts)).toBe(false)
  })
})
