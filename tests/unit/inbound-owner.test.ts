import { describe, it, expect } from 'vitest'
import { chooseInboundOwner, type InboundOwnerCandidate } from '../../utils/inboundOwner'

// server/api/whatsapp/webhook.post.ts asks this whose thread an inbound
// message from a shared family number belongs on.
const person = (id: string, over: Partial<InboundOwnerCandidate> = {}): InboundOwnerCandidate => ({
  id,
  isMinor: false,
  createdAt: '2026-01-01T00:00:00Z',
  lastActivityAt: null,
  tutorPatientId: null,
  ...over,
})

describe('Whose thread a message from a shared number lands on', () => {
  it('is nobody when nobody has the number', () => {
    expect(chooseInboundOwner([])).toBeNull()
  })

  it('is the only patient when there is one', () => {
    expect(chooseInboundOwner([person('a')])).toBe('a')
  })

  it('is never a child while an adult shares the phone, however recent the child thread', () => {
    const child = person('child', { isMinor: true, createdAt: '2020-01-01T00:00:00Z', lastActivityAt: '2026-10-03T10:00:00Z' })
    const parent = person('parent', { createdAt: '2026-05-01T00:00:00Z' })
    expect(chooseInboundOwner([child, parent])).toBe('parent')
  })

  it('is the patient whose conversation on the number is the live one', () => {
    const older = person('older', { createdAt: '2020-01-01T00:00:00Z', lastActivityAt: '2026-09-01T10:00:00Z' })
    const partner = person('partner', { createdAt: '2026-01-01T00:00:00Z', lastActivityAt: '2026-10-03T10:00:00Z' })
    expect(chooseInboundOwner([older, partner])).toBe('partner')
  })

  it("prefers a child's tutor over another adult when neither has talked", () => {
    const child = person('child', { isMinor: true, tutorPatientId: 'mum' })
    const dad = person('dad', { createdAt: '2019-01-01T00:00:00Z' })
    const mum = person('mum', { createdAt: '2025-01-01T00:00:00Z' })
    expect(chooseInboundOwner([child, dad, mum])).toBe('mum')
  })

  it('falls back to the oldest record, the same answer every time', () => {
    const a = person('b-id', { createdAt: '2024-01-01T00:00:00Z' })
    const b = person('a-id', { createdAt: '2025-01-01T00:00:00Z' })
    expect(chooseInboundOwner([b, a])).toBe('b-id')
    expect(chooseInboundOwner([a, b])).toBe('b-id')
  })

  it('takes a minor only when every record on the number is a minor', () => {
    const twinA = person('twin-a', { isMinor: true, createdAt: '2024-01-01T00:00:00Z' })
    const twinB = person('twin-b', { isMinor: true, createdAt: '2024-02-01T00:00:00Z' })
    expect(chooseInboundOwner([twinB, twinA])).toBe('twin-a')
  })
})
