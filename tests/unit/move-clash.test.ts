import { describe, it, expect } from 'vitest'
import { appointmentsUnderBlock, moveClashes, type ClashCandidateBlock } from '../../utils/moveClash'

// What a moved visit lands on (utils/moveClash.ts): only the blocks that
// apply to its practitioner or room. Other patients at the same time are not
// a clash -- most clinics see several an hour with one practitioner.
describe('Move clashes', () => {
  const at = (hm: string) => `2026-10-05T${hm}:00.000Z`
  const block = (from: string, to: string, extra: Partial<ClashCandidateBlock> = {}): ClashCandidateBlock => ({ starts_at: at(from), ends_at: at(to), practitioner_id: null, room_id: null, note: null, ...extra })
  const target = { appointmentId: 'moved', practitionerId: 'ana', roomId: 'sala1', startsAt: at('10:00'), endsAt: at('10:30') }

  it('counts clinic-wide blocks, the practitioner’s own and the room’s -- not someone else’s', () => {
    expect(moveClashes(target, [block('09:00', '11:00', { note: ' Formación ' })])).toEqual([{ kind: 'block', note: 'Formación', startsAt: at('09:00'), endsAt: at('11:00') }])
    expect(moveClashes(target, [block('10:00', '10:30', { practitioner_id: 'ana' })])).toHaveLength(1)
    expect(moveClashes(target, [block('10:00', '10:30', { room_id: 'sala1' })])).toHaveLength(1)
    expect(moveClashes(target, [block('10:00', '10:30', { practitioner_id: 'ben' })])).toEqual([])
    expect(moveClashes(target, [block('10:00', '10:30', { room_id: 'sala2' })])).toEqual([])
    expect(moveClashes(target, [block('10:30', '11:00')])).toEqual([])
  })

  // A practitioner who works at two clinics is one person: their own block at
  // the other clinic keeps them away from this one. A block for the whole of
  // the other clinic, or for one of its rooms, is that clinic's business.
  it('counts the practitioner’s own block at another clinic, and nothing else from there', () => {
    const here = { ...target, clinicId: 'centro' }
    expect(moveClashes(here, [block('10:00', '10:30', { practitioner_id: 'ana', clinic_id: 'norte' })])).toHaveLength(1)
    expect(moveClashes(here, [block('10:00', '10:30', { clinic_id: 'norte' })])).toEqual([])
    expect(moveClashes(here, [block('10:00', '10:30', { room_id: 'sala1', clinic_id: 'norte' })])).toEqual([])
    expect(moveClashes(here, [block('10:00', '10:30', { clinic_id: 'centro' })])).toHaveLength(1)
    expect(moveClashes(here, [block('10:00', '10:30', { room_id: 'sala1', clinic_id: 'centro' })])).toHaveLength(1)
  })

  it('lists every block, earliest first', () => {
    const got = moveClashes({ ...target, endsAt: at('12:00') }, [block('11:30', '12:00'), block('10:00', '10:15', { practitioner_id: 'ana' })])
    expect(got.map((c) => c.startsAt)).toEqual([at('10:00'), at('11:30')])
  })
})

describe('appointmentsUnderBlock', () => {
  const visit = (id: string, extra: Partial<{ practitioner_id: string; room_id: string; clinic_id: string; status: string; deleted_at: string; starts_at: string; ends_at: string }> = {}) => ({
    id,
    starts_at: '2026-11-02T09:00:00Z',
    ends_at: '2026-11-02T09:30:00Z',
    practitioner_id: 'ana',
    room_id: 'r1',
    clinic_id: 'c1',
    status: 'booked',
    deleted_at: null as string | null,
    patients: null,
    ...extra,
  })
  const morning = { startsAt: '2026-11-02T08:00:00Z', endsAt: '2026-11-02T12:00:00Z', clinicId: 'c1' }
  const visits = [
    visit('ana-here'),
    visit('ana-other-clinic', { clinic_id: 'c2', room_id: 'r9' }),
    visit('luis-r2', { practitioner_id: 'luis', room_id: 'r2' }),
    visit('luis-other-clinic', { practitioner_id: 'luis', clinic_id: 'c2' }),
    visit('afternoon', { starts_at: '2026-11-02T15:00:00Z', ends_at: '2026-11-02T15:30:00Z' }),
    visit('cancelled', { status: 'cancelled' }),
    visit('deleted', { deleted_at: '2026-11-01T00:00:00Z' }),
  ]
  const ids = (block: Parameters<typeof appointmentsUnderBlock>[0]) => appointmentsUnderBlock(block, visits).map((a) => a.id)

  it('catches a practitioner’s visits at every clinic', () => {
    expect(ids({ ...morning, practitionerId: 'ana', roomId: null })).toEqual(['ana-here', 'ana-other-clinic'])
  })
  it('catches only that room’s visits, at its own clinic', () => {
    expect(ids({ ...morning, practitionerId: null, roomId: 'r2' })).toEqual(['luis-r2'])
  })
  it('catches every visit at the clinic when it names nobody', () => {
    expect(ids({ ...morning, practitionerId: null, roomId: null })).toEqual(['ana-here', 'luis-r2'])
  })
})
