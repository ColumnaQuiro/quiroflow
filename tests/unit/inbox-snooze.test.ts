import { describe, it, expect } from 'vitest'
import { snoozePresets, snoozeStateOf } from '../../utils/inboxSnooze'

// Snoozing a conversation: the times offered, on the clinic's clock, and the
// rule a lead thread follows (the view applies the same one to the rest).
describe('Snooze times', () => {
  const tz = 'Europe/Madrid'
  const iso = (p: { at: Date }[]) => p.map((x) => x.at.toISOString())

  it('offers later today, tomorrow at nine and next Monday at nine', () => {
    // Wednesday 14 Oct 2026, 10:07 in Madrid (08:07Z).
    const p = snoozePresets(new Date('2026-10-14T08:07:00Z'), tz)
    expect(p.map((x) => x.key)).toEqual(['later', 'tomorrow', 'next_week'])
    expect(iso(p)).toEqual(['2026-10-14T11:15:00.000Z', '2026-10-15T07:00:00.000Z', '2026-10-19T07:00:00.000Z'])
  })

  it('leaves out "later today" in the evening', () => {
    // 19:30 in Madrid: three hours on is past nine.
    expect(snoozePresets(new Date('2026-10-14T17:30:00Z'), tz).map((x) => x.key)).toEqual(['tomorrow', 'next_week'])
  })

  it('takes a Monday to the Monday after', () => {
    expect(iso(snoozePresets(new Date('2026-10-19T08:00:00Z'), tz)).at(-1)).toBe('2026-10-26T08:00:00.000Z')
  })
})

describe('A snoozed lead thread', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  const snooze = { snoozed_until: '2026-10-15T07:00:00Z', created_at: '2026-10-14T10:00:00Z' }

  it('is out of sight until the time comes', () => {
    expect(snoozeStateOf(snooze, '2026-10-14T09:00:00Z', null, now)).toBe('hidden')
  })
  it('comes back as soon as they write', () => {
    expect(snoozeStateOf(snooze, '2026-10-14T11:00:00Z', null, now)).toBe(null)
  })
  it('is a follow-up once the time has passed, until it is opened', () => {
    const later = new Date('2026-10-15T08:00:00Z')
    expect(snoozeStateOf(snooze, '2026-10-14T09:00:00Z', '2026-10-14T09:30:00Z', later)).toBe('follow_up')
    expect(snoozeStateOf(snooze, '2026-10-14T09:00:00Z', '2026-10-15T07:30:00Z', later)).toBe(null)
  })
  it('is nothing without a snooze', () => {
    expect(snoozeStateOf(undefined, '2026-10-14T09:00:00Z', null, now)).toBe(null)
  })
})
