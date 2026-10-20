import { describe, it, expect } from 'vitest'
import { openAlerts, teamPushPlan, threadOf, unreadByThread, type TeamMessageRow } from '../../utils/teamMessages'

// Team messages: who a send reaches, which thread a message is in for the
// person reading it, and what counts as unread.

const row = (o: Partial<TeamMessageRow>): TeamMessageRow => ({
  id: crypto.randomUUID(),
  sender_id: 'ana',
  recipient_id: null,
  kind: 'message',
  body: 'hola',
  created_at: '2026-10-20T08:00:00Z',
  room_id: null,
  clinic_id: null,
  acknowledged_by: null,
  acknowledged_at: null,
  ...o,
})

describe('threadOf', () => {
  it('puts a whole-team message in the team thread and a direct one with the other person', () => {
    expect(threadOf(row({}), 'bea')).toBe('team')
    expect(threadOf(row({ sender_id: 'ana', recipient_id: 'bea' }), 'bea')).toBe('ana')
    expect(threadOf(row({ sender_id: 'ana', recipient_id: 'bea' }), 'ana')).toBe('bea')
  })
})

describe('unreadByThread', () => {
  it('counts others’ messages after the read marker, never your own', () => {
    const msgs = [
      row({ sender_id: 'ana', created_at: '2026-10-20T08:00:00Z' }),
      row({ sender_id: 'ana', created_at: '2026-10-20T09:00:00Z' }),
      row({ sender_id: 'bea', created_at: '2026-10-20T09:30:00Z' }),
      row({ sender_id: 'ana', recipient_id: 'bea', created_at: '2026-10-20T09:40:00Z' }),
    ]
    expect(unreadByThread(msgs, 'bea', { team: '2026-10-20T08:30:00Z' })).toEqual({ team: 1, ana: 1 })
  })
})

describe('teamPushPlan', () => {
  const members = [
    { id: 'ana', user_id: 'u-ana' },
    { id: 'bea', user_id: 'u-bea' },
    { id: 'carla', user_id: null },
    { id: 'dani', user_id: 'u-dani' },
  ]
  it('pushes a direct message to the recipient alone, honouring their settings', () => {
    expect(teamPushPlan({ kind: 'message', senderId: 'ana', recipientId: 'bea', members })).toEqual({ userIds: ['u-bea'], respectPreferences: true })
  })
  it('pushes a team message to everyone but the sender who can be reached', () => {
    expect(teamPushPlan({ kind: 'message', senderId: 'ana', recipientId: null, members }).userIds).toEqual(['u-bea', 'u-dani'])
  })
  it('pushes an alert to everyone but the sender, past preferences and quiet hours', () => {
    expect(teamPushPlan({ kind: 'alert', senderId: 'ana', recipientId: 'bea', members })).toEqual({ userIds: ['u-bea', 'u-dani'], respectPreferences: false })
  })
})

describe('openAlerts', () => {
  const now = new Date('2026-10-20T10:00:00Z').getTime()
  it('keeps an unanswered alert from the last half hour, and drops answered or stale ones', () => {
    const fresh = row({ kind: 'alert', created_at: '2026-10-20T09:50:00Z' })
    const answered = row({ kind: 'alert', created_at: '2026-10-20T09:55:00Z', acknowledged_at: '2026-10-20T09:56:00Z' })
    const stale = row({ kind: 'alert', created_at: '2026-10-20T09:00:00Z' })
    const plain = row({ created_at: '2026-10-20T09:59:00Z' })
    expect(openAlerts([fresh, answered, stale, plain], now)).toEqual([fresh])
  })
})
