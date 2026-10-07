import { describe, it, expect } from 'vitest'
import { moveClashes, type ClashCandidateAppointment, type ClashCandidateBlock } from '../../utils/moveClash'

// What a moved visit lands on (utils/moveClash.ts): the practitioner's other
// visits, the room's, and the blocks that apply to either.
describe('Move clashes', () => {
  const at = (hm: string) => `2026-10-05T${hm}:00.000Z`
  const appt = (id: string, from: string, to: string, extra: Partial<ClashCandidateAppointment> = {}): ClashCandidateAppointment => ({
    id,
    starts_at: at(from),
    ends_at: at(to),
    practitioner_id: 'ana',
    room_id: null,
    status: 'booked',
    deleted_at: null,
    patients: { first_name: 'Clara', last_name: 'Vidal' },
    ...extra,
  })
  const block = (from: string, to: string, extra: Partial<ClashCandidateBlock> = {}): ClashCandidateBlock => ({ starts_at: at(from), ends_at: at(to), practitioner_id: null, room_id: null, note: null, ...extra })
  const target = { appointmentId: 'moved', practitionerId: 'ana', roomId: 'sala1', startsAt: at('10:00'), endsAt: at('10:30') }

  it('names the practitioner’s other patient at that time', () => {
    expect(moveClashes(target, [appt('x', '10:15', '10:45')], [])).toEqual([
      { kind: 'appointment', via: 'practitioner', patientName: 'Clara Vidal', startsAt: at('10:15'), endsAt: at('10:45') },
    ])
  })

  it('is never a clash with itself, a cancelled or deleted visit, or one that only touches', () => {
    const rows = [
      appt('moved', '10:00', '10:30'),
      appt('c', '10:00', '10:30', { status: 'cancelled' }),
      appt('d', '10:00', '10:30', { deleted_at: at('09:00') }),
      appt('before', '09:30', '10:00'),
      appt('after', '10:30', '11:00'),
    ]
    expect(moveClashes(target, rows, [])).toEqual([])
  })

  it('counts another practitioner’s visit only when it shares the room', () => {
    const other = appt('y', '10:00', '10:30', { practitioner_id: 'ben', room_id: 'sala2' })
    expect(moveClashes(target, [other], [])).toEqual([])
    expect(moveClashes(target, [{ ...other, room_id: 'sala1' }], [])[0]).toMatchObject({ kind: 'appointment', via: 'room' })
    expect(moveClashes({ ...target, roomId: null }, [{ ...other, room_id: null }], [])).toEqual([])
  })

  it('counts clinic-wide blocks, the practitioner’s own and the room’s -- not someone else’s', () => {
    expect(moveClashes(target, [], [block('09:00', '11:00', { note: ' Formación ' })])).toEqual([{ kind: 'block', note: 'Formación', startsAt: at('09:00'), endsAt: at('11:00') }])
    expect(moveClashes(target, [], [block('10:00', '10:30', { practitioner_id: 'ana' })])).toHaveLength(1)
    expect(moveClashes(target, [], [block('10:00', '10:30', { room_id: 'sala1' })])).toHaveLength(1)
    expect(moveClashes(target, [], [block('10:00', '10:30', { practitioner_id: 'ben' })])).toEqual([])
    expect(moveClashes(target, [], [block('10:00', '10:30', { room_id: 'sala2' })])).toEqual([])
    expect(moveClashes(target, [], [block('10:30', '11:00')])).toEqual([])
  })

  // A practitioner who works at two clinics is one person: their own block at
  // the other clinic keeps them away from this one. A block for the whole of
  // the other clinic, or for one of its rooms, is that clinic's business.
  it('counts the practitioner’s own block at another clinic, and nothing else from there', () => {
    const here = { ...target, clinicId: 'centro' }
    expect(moveClashes(here, [], [block('10:00', '10:30', { practitioner_id: 'ana', clinic_id: 'norte' })])).toHaveLength(1)
    expect(moveClashes(here, [], [block('10:00', '10:30', { clinic_id: 'norte' })])).toEqual([])
    expect(moveClashes(here, [], [block('10:00', '10:30', { room_id: 'sala1', clinic_id: 'norte' })])).toEqual([])
    expect(moveClashes(here, [], [block('10:00', '10:30', { clinic_id: 'centro' })])).toHaveLength(1)
    expect(moveClashes(here, [], [block('10:00', '10:30', { room_id: 'sala1', clinic_id: 'centro' })])).toHaveLength(1)
  })

  it('lists everything, earliest first', () => {
    const got = moveClashes({ ...target, endsAt: at('12:00') }, [appt('late', '11:30', '12:00'), appt('early', '10:00', '10:30')], [block('11:00', '11:15')])
    expect(got.map((c) => c.startsAt)).toEqual([at('10:00'), at('11:00'), at('11:30')])
  })
})
