import { describe, expect, it } from 'vitest'
import { aiStatesFromMessages, leadAiState } from '../../utils/inboxAiState'

// Only leads carried an ai_state, so the receptionist answering a patient
// left no sign on the row.
describe('Whether the receptionist has a conversation', () => {
  it('is handling a patient when it wrote last for the clinic', () => {
    const states = aiStatesFromMessages([], [
      { patient_id: 'a', created_at: '2026-10-14T09:00:00Z', sent_by_ai: false },
      { patient_id: 'a', created_at: '2026-10-14T10:00:00Z', sent_by_ai: true },
      { patient_id: 'b', created_at: '2026-10-14T09:00:00Z', sent_by_ai: true },
      { patient_id: 'b', created_at: '2026-10-14T10:00:00Z', sent_by_ai: false },
    ])
    expect(states).toEqual({ a: 'handling' })
  })

  it('needs a person after a handover nobody has answered', () => {
    const states = aiStatesFromMessages(
      [
        { conversation_key: 'a', handed_over_at: '2026-10-14T10:00:00Z' },
        { conversation_key: 'b', handed_over_at: '2026-10-14T10:00:00Z' },
      ],
      [
        { patient_id: 'a', created_at: '2026-10-14T10:00:05Z', sent_by_ai: true },
        { patient_id: 'b', created_at: '2026-10-14T11:00:00Z', sent_by_ai: false },
      ],
    )
    expect(states).toEqual({ a: 'needs_human' })
  })

  it("reads a lead's own state", () => {
    expect(leadAiState('handling')).toBe('handling')
    expect(leadAiState('blocked')).toBe('needs_human')
    expect(leadAiState('paused')).toBeNull()
  })
})
