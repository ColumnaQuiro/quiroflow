import { describe, expect, it } from 'vitest'
import { personActiveUntil, PERSON_ACTIVE_MINUTES, unsentDraftDue, UNSENT_DRAFT_MINUTES } from '../../utils/receptionistAutoReply'

// When the hold on a conversation a person from the clinic is in ends: from
// then a reply held back for it is picked up again (receptionistHeld.ts),
// instead of sitting as a draft nobody looks at (29 Oct 2026).
describe('When a person stops holding a conversation', () => {
  const at = (iso: string) => ({ createdAt: iso })

  it('is an hour after the last thing somebody at the clinic wrote', () => {
    const until = personActiveUntil([
      { direction: 'outbound', sentByAi: false, ...at('2026-10-29T18:59:00Z') },
      { direction: 'inbound', sentByAi: false, ...at('2026-10-29T19:03:00Z') },
      { direction: 'outbound', sentByAi: false, ...at('2026-10-29T18:20:00Z') },
    ])
    expect(until?.toISOString()).toBe(new Date(Date.parse('2026-10-29T18:59:00Z') + PERSON_ACTIVE_MINUTES * 60_000).toISOString())
  })

  it('ignores the receptionist and the automations', () => {
    expect(personActiveUntil([
      { direction: 'outbound', sentByAi: true, ...at('2026-10-29T18:59:00Z') },
      { direction: 'outbound', sentByAi: false, automated: true, ...at('2026-10-29T19:00:00Z') },
      { direction: 'inbound', sentByAi: false, ...at('2026-10-29T19:03:00Z') },
    ])).toBeNull()
  })
})

// A draft nobody sends is handed over to a person after an hour, whatever the
// day: on Saturday 21 Nov 2026 one sat in the Inbox all weekend.
describe('A draft nobody has sent', () => {
  const drafted = '2026-11-21T12:16:00Z'

  it('waits the hour first', () => {
    expect(unsentDraftDue(drafted, new Date(Date.parse(drafted) + (UNSENT_DRAFT_MINUTES - 1) * 60_000))).toBe(false)
  })

  it('is handed over once the hour has passed', () => {
    expect(unsentDraftDue(drafted, new Date(Date.parse(drafted) + UNSENT_DRAFT_MINUTES * 60_000))).toBe(true)
  })

  it('is left alone once WhatsApp\'s window is closing', () => {
    expect(unsentDraftDue(drafted, new Date(Date.parse(drafted) + 21 * 3600_000))).toBe(false)
  })
})
