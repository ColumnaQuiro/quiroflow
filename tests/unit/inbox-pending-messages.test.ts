import { describe, it, expect } from 'vitest'
import { matchPendingToServer, mergePendingIntoThread, newestInConversation, type PendingThreadMessage, type ThreadMessage } from '../../utils/inboxPendingMessages'

// A reply in the Inbox showed twice for a moment after sending -- the clock
// bubble and the real message -- and then jumped as the bubble went away.
// The real row now takes the bubble's place, under the bubble's key.

const row = (id: string, at: string, over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id,
  patient_id: 'pat-1',
  phone_number: null,
  external_contact_id: null,
  direction: 'outbound',
  channel: 'whatsapp',
  body_preview: 'Hola, ¿te va bien el jueves?',
  media_type: null,
  media_filename: null,
  created_at: at,
  status: 'sent',
  ...over,
})
const bubble = (id: string, notBefore: string | null, over: Partial<PendingThreadMessage> = {}): PendingThreadMessage => ({
  ...row(id, '2026-10-03T10:00:00.500Z', { status: 'pending' }),
  notBefore,
  ...over,
})

describe('A sent reply and the row it became', () => {
  it('draws the real row instead of the bubble, under the bubble key', () => {
    // The realtime reload lands while the send is still in flight.
    const thread = mergePendingIntoThread(
      [row('in-1', '2026-10-03T09:58:00Z', { direction: 'inbound', body_preview: '¿Hay hueco?' }), row('real', '2026-10-03T10:00:01Z')],
      [bubble('pending-1', '2026-10-03T09:58:00Z')],
    )
    expect(thread.map((m) => [m.id, m.renderKey, m.status])).to.deep.equal([
      ['in-1', 'in-1', 'sent'],
      ['real', 'pending-1', 'sent'],
    ])
  })

  it('keeps the bubble until its row arrives', () => {
    const thread = mergePendingIntoThread([row('in-1', '2026-10-03T09:58:00Z', { direction: 'inbound' })], [bubble('pending-1', '2026-10-03T09:58:00Z')])
    expect(thread.map((m) => m.renderKey)).to.deep.equal(['in-1', 'pending-1'])
  })

  it('keeps the key after the bubble is dropped, so the row never remounts', () => {
    const thread = mergePendingIntoThread([row('real', '2026-10-03T10:00:01Z')], [], { real: 'pending-1' })
    expect(thread[0]!.renderKey).to.equal('pending-1')
  })

  it('never takes the row of the same text sent earlier', () => {
    // A second "ok": the first one is already in the thread when the bubble is made.
    const first = row('ok-1', '2026-10-03T10:00:01Z', { body_preview: 'ok' })
    const m = matchPendingToServer([first], [bubble('pending-2', first.created_at, { body_preview: 'ok' })])
    expect(m.size).to.equal(0)
  })

  it('gives two identical replies a row each, in order', () => {
    const m = matchPendingToServer(
      [row('ok-b', '2026-10-03T10:00:03Z', { body_preview: 'ok' }), row('ok-a', '2026-10-03T10:00:02Z', { body_preview: 'ok' })],
      [
        bubble('pending-1', '2026-10-03T09:00:00Z', { body_preview: 'ok', created_at: '2026-10-03T10:00:01Z' }),
        bubble('pending-2', '2026-10-03T09:00:00Z', { body_preview: 'ok', created_at: '2026-10-03T10:00:02Z' }),
      ],
    )
    expect([...m]).to.deep.equal([
      ['pending-1', 'ok-a'],
      ['pending-2', 'ok-b'],
    ])
  })

  it('matches a long reply by the part the server keeps', () => {
    const text = 'x'.repeat(2500)
    const m = matchPendingToServer([row('real', '2026-10-03T10:00:01Z', { body_preview: text.slice(0, 2000) })], [bubble('p', null, { body_preview: text })])
    expect(m.get('p')).to.equal('real')
  })

  it('matches a file by its type and name', () => {
    const file = { body_preview: null, media_type: 'document', media_filename: 'informe.pdf' }
    const m = matchPendingToServer(
      [row('other', '2026-10-03T10:00:01Z', { ...file, media_filename: 'otro.pdf' }), row('real', '2026-10-03T10:00:02Z', file)],
      [bubble('p', null, file)],
    )
    expect(m.get('p')).to.equal('real')
  })

  it('never matches across conversations, channels or directions', () => {
    const m = matchPendingToServer(
      [
        row('other-patient', '2026-10-03T10:00:01Z', { patient_id: 'pat-2' }),
        row('in-app', '2026-10-03T10:00:01Z', { channel: 'in_app' }),
        row('inbound', '2026-10-03T10:00:01Z', { direction: 'inbound' }),
      ],
      [bubble('p', null)],
    )
    expect(m.size).to.equal(0)
  })

  it('leaves a failed bubble alone: a failed send writes no row', () => {
    const m = matchPendingToServer([row('real', '2026-10-03T10:00:01Z')], [bubble('p', null, { status: 'failed' })])
    expect(m.size).to.equal(0)
  })

  it('reads the newest message of one conversation', () => {
    const messages = [row('a', '2026-10-03T09:00:00Z'), row('b', '2026-10-03T09:30:00Z', { patient_id: 'pat-2' }), row('c', '2026-10-03T09:10:00Z')]
    expect(newestInConversation(messages, 'pat-1')).to.equal('2026-10-03T09:10:00Z')
    expect(newestInConversation(messages, 'nobody')).to.equal(null)
  })
})
