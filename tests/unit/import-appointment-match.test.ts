import { describe, it, expect } from 'vitest'
import { matchIncomingAppointments, type ExistingAppointment, type IncomingAppointment } from '../../utils/importAppointmentMatch'

// Which appointment here a PracticeHub export row is. Pure, so pinned here
// rather than through a seeded import. The cases are Columnaquiro's 3-10 Sep
// 2026 re-creations, as they stood in production on 30 Sep.
const CLINIC = 'clinic-1'
const TZ = 'Europe/Madrid'

// Madrid wall-clock times, as the export writes them. September is UTC+2.
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+02:00`).toISOString()

let nextKey = 0
const row = (ref: string | null, start: string, end: string, over: Partial<IncomingAppointment> = {}): IncomingAppointment => ({
  key: nextKey++,
  ref,
  patientId: 'pat-1',
  startsAt: at(start),
  endsAt: at(end),
  status: 'completed',
  ...over,
})
const here = (id: string, start: string, end: string, over: Partial<ExistingAppointment> = {}): ExistingAppointment => ({
  id,
  patientId: 'pat-1',
  clinicId: CLINIC,
  externalReference: null,
  startsAt: at(start),
  endsAt: at(end),
  status: 'completed',
  ...over,
})
const match = (rows: IncomingAppointment[], existing: ExistingAppointment[], extraRefs: string[] = []) =>
  matchIncomingAppointments(rows, existing, new Set([...rows.map((r) => r.ref!).filter(Boolean), ...extraRefs]), CLINIC, TZ)

describe('Matching a PracticeHub appointment to one already here', () => {
  it("uses PracticeHub's own id when it is here", () => {
    const r = row('9500', '2026-09-09 10:00', '2026-09-09 10:15')
    expect(match([r], [here('a', '2026-09-09 10:00', '2026-09-09 10:15', { externalReference: '9500' })]).get(r.key)).to.deep.equal({ kind: 'ref', existingId: 'a' })
  })

  it('adopts the visit imported under an id PracticeHub has since deleted', () => {
    // Beatriz López Ibáñez: 9851 here at 14:45, deleted in PracticeHub and
    // re-created as 9876 at 14:00. Not overlapping -- time only breaks ties.
    const r = row('9876', '2026-09-09 14:00', '2026-09-09 14:15')
    const m = match([r], [here('a', '2026-09-09 14:45', '2026-09-09 15:00', { externalReference: '9851' })])
    expect(m.get(r.key)).to.deep.equal({ kind: 'adopt', existingId: 'a', replacesRef: '9851' })
  })

  it('adopts a visit entered in QuiroFlow, which carries no PracticeHub id', () => {
    const r = row('9884', '2026-09-10 15:15', '2026-09-10 15:30')
    expect(match([r], [here('a', '2026-09-10 15:15', '2026-09-10 15:30')]).get(r.key)).to.deep.equal({ kind: 'adopt', existingId: 'a', replacesRef: null })
  })

  it('never takes a visit whose id is still in the export', () => {
    // That visit is PracticeHub's record of a different appointment.
    const r = row('9900', '2026-09-09 10:00', '2026-09-09 10:15')
    const m = match([r], [here('a', '2026-09-09 10:00', '2026-09-09 10:15', { externalReference: '9500' })], ['9500'])
    expect(m.get(r.key)).to.deep.equal({ kind: 'insert' })
  })

  it("does not treat an id as deleted on a day the export doesn't cover", () => {
    // An export cut to September says nothing about an August visit.
    const r = row('9900', '2026-09-09 10:00', '2026-09-09 10:15')
    const m = match([r, row('9901', '2026-09-20 10:00', '2026-09-20 10:15', { patientId: 'pat-2' })], [here('a', '2026-08-20 10:00', '2026-08-20 10:15', { externalReference: '9100' })])
    expect(m.get(r.key)).to.deep.equal({ kind: 'insert' })
  })

  it('inserts when the patient has nothing here that day', () => {
    const r = row('9900', '2026-09-09 10:00', '2026-09-09 10:15')
    expect(match([r], [here('a', '2026-09-08 10:00', '2026-09-08 10:15')]).get(r.key)).to.deep.equal({ kind: 'insert' })
  })

  it("reads the day at the clinic, not in UTC", () => {
    // 00:30 in Madrid on the 10th is 22:30 UTC on the 9th.
    const r = row('9900', '2026-09-10 00:30', '2026-09-10 00:45')
    expect(match([r], [here('a', '2026-09-10 09:00', '2026-09-10 09:15')]).get(r.key)?.kind).to.equal('adopt')
  })

  it('ignores a visit at another clinic, and another patient', () => {
    const r = row('9900', '2026-09-09 10:00', '2026-09-09 10:15')
    const m = match([r], [here('a', '2026-09-09 10:00', '2026-09-09 10:15', { clinicId: 'clinic-2' }), here('b', '2026-09-09 10:00', '2026-09-09 10:15', { patientId: 'pat-2' })])
    expect(m.get(r.key)).to.deep.equal({ kind: 'insert' })
  })

  it('never lets a cancellation take a visit that happened, or the reverse', () => {
    // Carmen Berbel, 3 Sep: a completed visit entered here and a cancelled
    // 9613 that PracticeHub deleted. Re-created 9865 is the visit.
    const visit = row('9865', '2026-09-03 16:00', '2026-09-03 16:45')
    const m = match([visit], [here('native', '2026-09-03 16:00', '2026-09-03 16:30'), here('old', '2026-09-03 16:00', '2026-09-03 16:45', { externalReference: '9613', status: 'cancelled' })])
    expect(m.get(visit.key)).to.deep.equal({ kind: 'adopt', existingId: 'native', replacesRef: null })

    const cancellation = row('9901', '2026-09-03 16:00', '2026-09-03 16:45', { status: 'cancelled' })
    expect(match([cancellation], [here('native', '2026-09-03 16:00', '2026-09-03 16:30')]).get(cancellation.key)).to.deep.equal({ kind: 'insert' })
  })

  it('picks the one overlapping visit when the day has several', () => {
    // Maximiliano Mosciaro, 10 Sep: 17:30 booked here, plus an 18:16 visit
    // started from the check-out screen. 9889 is 17:30.
    const r = row('9889', '2026-09-10 17:30', '2026-09-10 18:00')
    const m = match([r], [here('booked', '2026-09-10 17:30', '2026-09-10 18:00'), here('walkin', '2026-09-10 18:16', '2026-09-10 18:46')])
    expect(m.get(r.key)).to.deep.equal({ kind: 'adopt', existingId: 'booked', replacesRef: null })
  })

  it('holds a row when several visits that day could be the one', () => {
    const r = row('9900', '2026-09-09 12:00', '2026-09-09 12:15')
    const m = match([r], [here('a', '2026-09-09 10:00', '2026-09-09 10:15'), here('b', '2026-09-09 16:00', '2026-09-09 16:15')])
    expect(m.get(r.key)).to.deep.equal({ kind: 'held', reason: 'several', existingIds: ['a', 'b'] })
  })

  it('holds both rows when two reach for the same visit', () => {
    // Two visits in PracticeHub, one here: which one is here cannot be told.
    const morning = row('9900', '2026-09-09 10:00', '2026-09-09 10:15')
    const evening = row('9901', '2026-09-09 18:00', '2026-09-09 18:15')
    const m = match([morning, evening], [here('a', '2026-09-09 10:00', '2026-09-09 10:15')])
    expect(m.get(morning.key)).to.deep.equal({ kind: 'held', reason: 'contested', existingIds: ['a'] })
    expect(m.get(evening.key)).to.deep.equal({ kind: 'held', reason: 'contested', existingIds: ['a'] })
  })

  it("holds the day when PracticeHub moved the visit's id to another date and re-created the visit", () => {
    // Ivanna Acosta: 9415 here, completed on 9 Sep. PracticeHub now has 9415
    // pending on 15 Sep, and the 9 Sep visit as 9871. Following the id would
    // move a visit that happened into next week; inserting 9871 would double
    // the 9th. Neither row is applied.
    const moved = row('9415', '2026-09-15 10:00', '2026-09-15 10:15', { status: 'booked' })
    const recreated = row('9871', '2026-09-09 10:15', '2026-09-09 10:30')
    const m = match([moved, recreated], [here('a', '2026-09-09 10:30', '2026-09-09 10:45', { externalReference: '9415' })])
    expect(m.get(recreated.key)).to.deep.equal({ kind: 'held', reason: 'moved_away', existingIds: ['a'] })
    expect(m.get(moved.key)).to.deep.equal({ kind: 'held', reason: 'moved_away', existingIds: ['a'] })
  })

  it('holds the day when PracticeHub gave the id to another patient', () => {
    // Ximena Sanchez Abad: 9809 here on 9 Sep. PracticeHub's 9809 is now her
    // relative's appointment; her own 9 Sep visit is 9877.
    const reassigned = row('9809', '2026-09-09 16:30', '2026-09-09 16:45', { patientId: 'pat-2' })
    const recreated = row('9877', '2026-09-09 15:00', '2026-09-09 15:15')
    const m = match([reassigned, recreated], [here('a', '2026-09-09 16:30', '2026-09-09 16:45', { externalReference: '9809' })])
    expect(m.get(recreated.key)?.kind).to.equal('held')
    expect(m.get(reassigned.key)?.kind).to.equal('held')
  })

  it('leaves an id that moved days alone when nothing was re-created in its place', () => {
    // A plain reschedule: PracticeHub is authoritative and the visit follows it.
    const moved = row('9415', '2026-09-15 10:00', '2026-09-15 10:15', { status: 'booked' })
    expect(match([moved], [here('a', '2026-09-09 10:30', '2026-09-09 10:45', { externalReference: '9415' })]).get(moved.key)).to.deep.equal({ kind: 'ref', existingId: 'a' })
  })
})
