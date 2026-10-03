import { describe, expect, it } from 'vitest'
import { lastScheduledOccurrence, nextAllowedSendTime, segmentIsDue } from '../../utils/automationTiming'

// Quiet hours and segment schedules are wall-clock times at the clinic. On the
// two days a year the clocks change, the day is 23 or 25 hours long, so
// "local midnight + 10 hours" is not 10:00 -- it was 09:00 on 25 Oct 2026 and
// 11:00 on 29 Mar 2026 until these were read as real wall-clock times.

const MADRID = 'Europe/Madrid'
const everyDay = { from: '10:00', to: '20:00' }

describe('quiet hours on a clock-change day (Europe/Madrid)', () => {
  it('opens at 10:00 CET on 25 Oct 2026, the 25-hour day', () => {
    const at = new Date('2026-10-25T05:00:00Z') // 06:00 CET, after the 03:00 -> 02:00 switch
    expect(nextAllowedSendTime(at, everyDay, MADRID).toISOString()).toBe('2026-10-25T09:00:00.000Z')
  })

  it('opens at 10:00 CEST on 29 Mar 2026, the 23-hour day', () => {
    const at = new Date('2026-03-29T03:00:00Z') // 05:00 CEST, after the 02:00 -> 03:00 switch
    expect(nextAllowedSendTime(at, everyDay, MADRID).toISOString()).toBe('2026-03-29T08:00:00.000Z')
  })

  it('treats 09:30 CET on 25 Oct as still before the window', () => {
    const at = new Date('2026-10-25T08:30:00Z') // 09:30 CET
    expect(nextAllowedSendTime(at, everyDay, MADRID).toISOString()).toBe('2026-10-25T09:00:00.000Z')
  })

  it('opens at 10:00 on an ordinary day either side', () => {
    expect(nextAllowedSendTime(new Date('2026-10-24T03:00:00Z'), everyDay, MADRID).toISOString()).toBe('2026-10-24T08:00:00.000Z')
    expect(nextAllowedSendTime(new Date('2026-10-26T03:00:00Z'), everyDay, MADRID).toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(nextAllowedSendTime(new Date('2026-03-28T03:00:00Z'), everyDay, MADRID).toISOString()).toBe('2026-03-28T09:00:00.000Z')
  })

  it('moves a window opening inside the skipped hour to just after the jump', () => {
    // 02:30 does not exist on 29 Mar 2026; the first real minute after it is 03:30 CEST.
    const at = new Date('2026-03-28T23:30:00Z') // 00:30 CET
    expect(nextAllowedSendTime(at, { from: '02:30', to: '06:00' }, MADRID).toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })
})

describe('segment schedules on a clock-change day (Europe/Madrid)', () => {
  const daily = { kind: 'daily' as const, time: '09:00' }
  const created = new Date('2026-01-01T00:00:00Z')

  it('runs at 09:00 CET on 25 Oct 2026, not 08:00', () => {
    const now = new Date('2026-10-25T08:30:00Z') // 09:30 CET
    expect(lastScheduledOccurrence(daily, now, MADRID, created)?.toISOString()).toBe('2026-10-25T08:00:00.000Z')
    // 08:30 CET: the day's run has not come yet.
    expect(segmentIsDue(daily, new Date('2026-10-24T07:01:00Z'), created, new Date('2026-10-25T07:30:00Z'), MADRID)).toBe(false)
  })

  it('runs at 09:00 CEST on 29 Mar 2026, not 10:00', () => {
    const now = new Date('2026-03-29T07:30:00Z') // 09:30 CEST
    expect(lastScheduledOccurrence(daily, now, MADRID, created)?.toISOString()).toBe('2026-03-29T07:00:00.000Z')
    expect(segmentIsDue(daily, new Date('2026-03-28T08:01:00Z'), created, now, MADRID)).toBe(true)
  })

  it('runs at 09:00 on an ordinary day', () => {
    const now = new Date('2026-10-24T07:30:00Z') // 09:30 CEST
    expect(lastScheduledOccurrence(daily, now, MADRID, created)?.toISOString()).toBe('2026-10-24T07:00:00.000Z')
  })
})
