import { describe, it, expect } from 'vitest'
import { mergeThreadTail, threadTailSince, THREAD_TAIL_MS } from '../../utils/inboxThreadTail'

// The open Inbox thread is refreshed by re-reading its last day rather than
// its newest 300 messages. What comes back replaces that stretch.

const msg = (id: string, at: string, status = 'sent') => ({ id, created_at: at, status })

describe('threadTailSince', () => {
  it('is a day before the newest message, whatever order they come in', () => {
    const current = [msg('a', '2026-10-13T09:00:00.000000+00:00'), msg('b', '2026-10-13T12:00:00.123456+00:00'), msg('c', '2026-10-12T08:00:00Z')]
    expect(threadTailSince(current)).toBe(Date.parse('2026-10-13T12:00:00.123Z') - THREAD_TAIL_MS)
  })
})

describe('mergeThreadTail', () => {
  const old = msg('old', '2026-10-10T10:00:00+00:00')
  const recent = msg('recent', '2026-10-13T09:00:00+00:00', 'sent')
  const sinceMs = Date.parse('2026-10-12T12:00:00Z')

  it('adds what arrived and takes the new ticks of what was there', () => {
    const merged = mergeThreadTail([old, recent], [msg('recent', '2026-10-13T09:00:00+00:00', 'read'), msg('new', '2026-10-13T13:00:00+00:00')], sinceMs)
    expect(merged.map((m) => [m.id, m.status])).toEqual([['old', 'sent'], ['recent', 'read'], ['new', 'sent']])
  })

  it('drops a message from the re-read stretch that is no longer in this conversation', () => {
    const merged = mergeThreadTail([old, recent], [], sinceMs)
    expect(merged.map((m) => m.id)).toEqual(['old'])
  })

  it('keeps everything older than the stretch untouched', () => {
    const merged = mergeThreadTail([old, recent], [recent], sinceMs)
    expect(merged[0]).toBe(old)
  })

  it('compares times across the database and JavaScript formats, and never lists one twice', () => {
    // Exactly at the boundary, written the way Postgres writes it.
    const edge = msg('edge', '2026-10-12T12:00:00.000000+00:00')
    const merged = mergeThreadTail([edge, recent], [edge, recent], sinceMs)
    expect(merged.map((m) => m.id)).toEqual(['edge', 'recent'])
  })
})
