import { describe, expect, it } from 'vitest'
import { latestHandoverReason } from '../../utils/inboxAiState'

// The Inbox banner says why the receptionist handed a conversation over,
// read from the note it leaves (receptionistSend.ts, announceHandover). A
// person's note that happens to start the same way is theirs, not the
// receptionist's, and is never mistaken for a handover.

describe('latestHandoverReason', () => {
  it('reads the reason off the newest handover note', () => {
    expect(
      latestHandoverReason([
        { author_id: null, body: 'He pasado esta conversación a una persona. Motivo: Quiere cancelar.', created_at: '2026-10-19T09:00:00Z' },
        { author_id: null, body: 'He pasado esta conversación a una persona. Motivo: Menciona dolor torácico.', created_at: '2026-10-19T10:00:00Z' },
      ]),
    ).toBe('Menciona dolor torácico.')
  })

  it('ignores notes written by people and notes about other things', () => {
    expect(
      latestHandoverReason([
        { author_id: 'tm-1', body: 'He pasado esta conversación a una persona. Motivo: yo', created_at: '2026-10-19T09:00:00Z' },
        { author_id: null, body: 'He reservado Ajuste el lunes a las 10:00.', created_at: '2026-10-19T10:00:00Z' },
      ]),
    ).toBeNull()
  })

  it('falls back to the whole note when it has no reason line', () => {
    expect(latestHandoverReason([{ author_id: null, body: 'He pasado esta conversación a una persona.', created_at: '2026-10-19T09:00:00Z' }])).toBe('He pasado esta conversación a una persona.')
  })
})
