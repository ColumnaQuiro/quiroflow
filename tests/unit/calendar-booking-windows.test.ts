import { describe, it, expect } from 'vitest'
import { onlineBookingBands, type BookingWindowType } from '../../utils/calendarBookingWindows'

// The hours the calendar tints as kept for online booking
// (utils/calendarBookingWindows.ts): a type's online windows, only where
// someone on screen works them.
describe('Online booking windows on the calendar', () => {
  const firstVisit: BookingWindowType = {
    id: 'first',
    name: 'Primera visita',
    color: '#d496e3',
    online_booking_enabled: true,
    online_booking_windows: { all: { tue: [['18:00', '19:30']], thu: [['18:00', '19:30']] } },
  }
  const report: BookingWindowType = {
    id: 'report',
    name: 'Informe',
    color: '#88ebac',
    online_booking_enabled: true,
    online_booking_windows: { all: { tue: [['10:00', '11:00']] } },
  }
  const anyone = [{ id: 'p1', working: null }]

  it('tints each window of each type, in time order', () => {
    expect(onlineBookingBands([firstVisit, report], 'tue', anyone)).toEqual([
      { from: '10:00', to: '11:00', types: [{ id: 'report', name: 'Informe', color: '#88ebac' }] },
      { from: '18:00', to: '19:30', types: [{ id: 'first', name: 'Primera visita', color: '#d496e3' }] },
    ])
  })

  it('shows nothing on a day the type has no window', () => {
    expect(onlineBookingBands([firstVisit], 'wed', anyone)).toEqual([])
  })

  it('leaves out types that are not limited to set times, not online, or archived', () => {
    const whenever = { ...firstVisit, id: 'w', online_booking_windows: null }
    const offline = { ...firstVisit, id: 'o', online_booking_enabled: false }
    const archived = { ...firstVisit, id: 'a', archived_at: '2026-11-01T00:00:00Z' }
    expect(onlineBookingBands([whenever, offline, archived], 'tue', anyone)).toEqual([])
  })

  it('cuts a window to the hours the practitioner works, as the booking page does', () => {
    const bands = onlineBookingBands([firstVisit], 'tue', [{ id: 'p1', working: [['09:00', '19:00']] }])
    expect(bands.map((b) => [b.from, b.to])).toEqual([['18:00', '19:00']])
    expect(onlineBookingBands([firstVisit], 'tue', [{ id: 'p1', working: [] }])).toEqual([])
  })

  it("uses a practitioner's own week over the clinic-wide one", () => {
    const own: BookingWindowType = { ...firstVisit, online_booking_windows: { all: firstVisit.online_booking_windows!.all, practitioners: { p2: { tue: [['16:00', '17:00']] } } } }
    expect(onlineBookingBands([own], 'tue', [{ id: 'p2', working: null }]).map((b) => [b.from, b.to])).toEqual([['16:00', '17:00']])
  })

  it('joins everyone on the clinic tab into one band per window', () => {
    const bands = onlineBookingBands([firstVisit], 'tue', [
      { id: 'p1', working: [['15:00', '19:00']] },
      { id: 'p2', working: [['18:30', '20:00']] },
    ])
    expect(bands.map((b) => [b.from, b.to])).toEqual([['18:00', '19:30']])
  })

  it('skips practitioners the type cannot be booked with', () => {
    const onlyP2 = { ...firstVisit, practitioner_ids: ['p2'] }
    expect(onlineBookingBands([onlyP2], 'tue', [{ id: 'p1', working: null }])).toEqual([])
    expect(onlineBookingBands([onlyP2], 'tue', [{ id: 'p2', working: null }])).toHaveLength(1)
  })

  it('puts two types kept for the same window in one band', () => {
    const revision = { ...firstVisit, id: 'rev', name: 'Revisión', color: '#e3be78' }
    const bands = onlineBookingBands([firstVisit, revision], 'thu', anyone)
    expect(bands).toHaveLength(1)
    expect(bands[0].types.map((x) => x.name)).toEqual(['Primera visita', 'Revisión'])
  })
})
