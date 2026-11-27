import { describe, expect, it } from 'vitest'
import { practiceHubMainLocation, practiceHubRoomMatches, practiceHubRoomPlan, roomNameBare, roomNameKey } from '../../utils/practicehubImport/rooms'

// Which room here a PracticeHub appointment was in (utils/practicehubImport/rooms.ts).
// The rooms and locations are invented.

const rooms = (...names: string[]) => names.map((name, i) => ({ id: `room-${i + 1}`, name }))
const matched = (m: Map<string, { name: string } | undefined>) => Object.fromEntries([...m].map(([id, room]) => [id, room?.name ?? null]))

describe('room names', () => {
  it('compare ignoring case, accents and spacing', () => {
    expect(roomNameKey('  Sala  1 ')).to.equal('sala 1')
    expect(roomNameKey('Habitación_2')).to.equal('habitacion 2')
    expect(roomNameKey(null)).to.equal('')
  })

  it('drop a leading word like Sala only when something is left', () => {
    expect(roomNameBare('Sala 1')).to.equal('1')
    expect(roomNameBare('Camilla-3')).to.equal('3')
    expect(roomNameBare('Sala')).to.equal('sala')
    expect(roomNameBare('FV')).to.equal('fv')
    expect(roomNameBare('Sala de espera')).to.equal('de espera')
  })
})

describe('the PracticeHub location a clinic is', () => {
  it('is the one holding more than half of the visits, or none', () => {
    expect(practiceHubMainLocation([{ id: 1, location_id: 1 }, { id: 2, location_id: 1 }, { id: 3, location_id: 2 }])).to.equal('1')
    expect(practiceHubMainLocation([{ id: 1, location_id: 1 }, { id: 2, location_id: 2 }])).to.equal(null)
    expect(practiceHubMainLocation([])).to.equal(null)
  })
})

describe('matching PracticeHub rooms to rooms here', () => {
  it('matches the same name first, then the bare number when it is unique on both sides', () => {
    const m = practiceHubRoomMatches({
      locationId: '1',
      roomsHere: rooms('1', 'Camilla 2', 'FV'),
      resources: [
        { id: 1, location_id: 1, name: 'SALA 1' },
        { id: 2, location_id: 1, name: 'Sala 2' },
        { id: 3, location_id: 1, name: 'fv' },
        { id: 4, location_id: 1, name: 'Sala 4' },
        { id: 5, location_id: 2, name: '1' },
      ],
    })
    expect(matched(m)).to.deep.equal({ 1: '1', 2: 'Camilla 2', 3: 'FV', 4: null })
  })

  it('never puts two PracticeHub rooms with the same number into one room by the loose match', () => {
    const m = practiceHubRoomMatches({
      locationId: '1',
      roomsHere: rooms('1'),
      resources: [{ id: 1, location_id: 1, name: 'Sala 1' }, { id: 2, location_id: 1, name: 'Camilla 1' }],
    })
    expect(matched(m)).to.deep.equal({ 1: null, 2: null })
  })

  it('takes the exact name even when the bare one is shared, and the first of two rooms with one name', () => {
    const m = practiceHubRoomMatches({
      locationId: '1',
      roomsHere: rooms('1', '1', 'Sala 1'),
      resources: [{ id: 1, location_id: 1, name: '1' }, { id: 2, location_id: 1, name: 'sala 1' }],
    })
    expect(m.get('1')?.id).to.equal('room-1')
    expect(m.get('2')?.id).to.equal('room-3')
  })
})

describe('a room plan', () => {
  it('rooms only the visits at the main location, in a room at that location', () => {
    const plan = practiceHubRoomPlan({
      roomsHere: rooms('1', '2'),
      resources: [{ id: 1, location_id: 1, name: '1' }, { id: 2, location_id: 1, name: '2' }, { id: 7, location_id: 2, name: '1' }],
      appointments: [
        { id: 10, location_id: 1, resource_id: 1 },
        { id: 11, location_id: 1, resource_id: 2 },
        { id: 12, location_id: 1, resource_id: 7 }, // a resource from elsewhere: the ids do not agree
        { id: 13, location_id: 2, resource_id: 7 },
        { id: 14, location_id: 1, resource_id: null },
      ],
    })
    expect(plan.locationId).to.equal('1')
    expect(['10', '11', '12', '13', '14'].map((id) => plan.roomFor(id)?.name ?? null)).to.deep.equal(['1', '2', null, null, null])
    expect(plan.elsewhere).to.equal(1)
    expect(plan.rooms.map((r) => [r.name, r.room?.name ?? null, r.visits])).to.deep.equal([['1', '1', 1], ['2', '2', 1]])
  })

  it('rooms nothing when no location holds most of the visits', () => {
    const plan = practiceHubRoomPlan({
      roomsHere: rooms('1'),
      resources: [{ id: 1, location_id: 1, name: '1' }, { id: 2, location_id: 2, name: '1' }],
      appointments: [{ id: 10, location_id: 1, resource_id: 1 }, { id: 11, location_id: 2, resource_id: 2 }],
    })
    expect(plan.locationId).to.equal(null)
    expect(plan.roomFor('10')).to.equal(null)
    expect(plan.elsewhere).to.equal(2)
  })
})
