import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/utils/receptionistModel', () => ({}))
const { traceToolUses } = await import('../../server/utils/receptionistTrace')

// What a reply's record keeps of the tools it called: when, what and how,
// never who -- the booking's name, phone and email, and the hand-over's
// reason, stay in the conversation.
describe("A reply's record of its tool calls", () => {
  it('keeps dates, times and types, and drops names, numbers and reasons', () => {
    const kept = traceToolUses([
      { name: 'book_appointment', ok: true, input: { date: '2026-11-12', time: '19:00', appointment_type: 'Oferta Primera visita', full_name: 'Persona Inventada', email: 'x@example.com', phone: '600000000' } },
      { name: 'hand_over_to_colleague', ok: true, input: { reason: 'Persona Inventada pide su informe' } },
    ])
    expect(kept).toEqual([
      { name: 'book_appointment', ok: true, input: { date: '2026-11-12', time: '19:00', appointment_type: 'Oferta Primera visita' } },
      { name: 'hand_over_to_colleague', ok: true, input: {} },
    ])
  })
})
