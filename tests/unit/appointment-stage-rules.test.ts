import { describe, it, expect } from 'vitest'
import { appointmentStage, isUnconfirmedStage, matchesFilter, needsNextBookingFlag, nextStep, stageCounts, trackIndex, type StageInput } from '../../utils/appointmentStage'
import { blockLadder, shortPatientName, type LadderInput } from '../../utils/appointmentBlock'
import { mergeWindows, unionWorkingWindows } from '../../utils/businessHours'
import { bonoForVisit } from '../../utils/visitPayment'

// Unit-style: no cy.visit, no seeding -- same shape as visit-payment-rules.
// These are the rules every calendar surface reads a visit's stage, its
// block's contents and its hatching from, pinned without a browser.

const booked: StageInput = {
  status: 'booked',
  confirmation_status: null,
  source: 'staff',
  checked_in_at: null,
  flow_with_practitioner_at: null,
  flow_checkout_at: null,
}
const at = '2026-09-23T16:00:00.000Z'

describe('Appointment stage', () => {
  it('reads each column combination as one stage', () => {
    expect(appointmentStage({ ...booked, confirmation_status: 'pending' })).to.equal('pending')
    expect(appointmentStage({ ...booked, source: 'online', confirmation_status: 'pending' })).to.equal('online')
    expect(appointmentStage({ ...booked, confirmation_status: 'reschedule_requested' })).to.equal('resched')
    expect(appointmentStage({ ...booked, confirmation_status: 'confirmed' })).to.equal('confirmed')
    expect(appointmentStage({ ...booked, checked_in_at: at })).to.equal('arrived')
    expect(appointmentStage({ ...booked, checked_in_at: at, flow_with_practitioner_at: at })).to.equal('withp')
    expect(appointmentStage({ ...booked, checked_in_at: at, flow_with_practitioner_at: at, flow_checkout_at: at })).to.equal('checkout')
    expect(appointmentStage({ ...booked, status: 'completed' })).to.equal('completed')
    expect(appointmentStage({ ...booked, status: 'no_show' })).to.equal('noshow')
    expect(appointmentStage({ ...booked, status: 'cancelled' })).to.equal('cancelled')
  })

  it('calls a staff booking with no confirmation requested confirmed, not unconfirmed', () => {
    // A clinic with confirmations switched off would otherwise see every
    // border dashed, forever.
    expect(appointmentStage(booked)).to.equal('confirmed')
  })

  it('keeps an online booking unconfirmed until someone confirms it', () => {
    expect(appointmentStage({ ...booked, source: 'online' })).to.equal('online')
    expect(appointmentStage({ ...booked, source: 'online', confirmation_status: 'confirmed' })).to.equal('confirmed')
  })

  it('lets turning up outrank what the patient said beforehand', () => {
    // Asked to move it, then came anyway: they are waiting, not "wants to move".
    expect(appointmentStage({ ...booked, confirmation_status: 'reschedule_requested', checked_in_at: at })).to.equal('arrived')
  })

  it('lets the status outrank the flow timestamps', () => {
    expect(appointmentStage({ ...booked, status: 'completed', checked_in_at: at, flow_checkout_at: at })).to.equal('completed')
    expect(appointmentStage({ ...booked, status: 'cancelled', checked_in_at: at })).to.equal('cancelled')
  })

  it('lands on the latest step when one was skipped', () => {
    expect(appointmentStage({ ...booked, flow_checkout_at: at })).to.equal('checkout')
  })

  it('dashes only the not-firm stages', () => {
    expect(['pending', 'online', 'resched'].every((s) => isUnconfirmedStage(s as never))).to.equal(true)
    expect(['confirmed', 'arrived', 'withp', 'checkout', 'completed', 'noshow'].some((s) => isUnconfirmedStage(s as never))).to.equal(false)
  })

  it('offers one step forward, and none once the visit is over', () => {
    expect(nextStep('pending')).to.equal('checkin')
    expect(nextStep('confirmed')).to.equal('checkin')
    expect(nextStep('arrived')).to.equal('withp')
    expect(nextStep('withp')).to.equal('checkout')
    expect(nextStep('checkout')).to.equal('charge')
    expect(nextStep('completed')).to.equal(null)
    expect(nextStep('noshow')).to.equal(null)
    expect(nextStep('cancelled')).to.equal(null)
    expect(trackIndex('confirmed')).to.equal(0)
    expect(trackIndex('completed')).to.equal(4)
    expect(trackIndex('pending')).to.equal(-1)
  })
})

describe('"Sin próxima"', () => {
  const now = new Date('2026-09-23T15:00:00')
  it('flags only in the room, at the desk, or done today', () => {
    expect(needsNextBookingFlag('withp', now, false, now)).to.equal(true)
    expect(needsNextBookingFlag('checkout', now, false, now)).to.equal(true)
    expect(needsNextBookingFlag('completed', new Date('2026-09-23T09:00:00'), false, now)).to.equal(true)
    expect(needsNextBookingFlag('completed', new Date('2026-09-22T09:00:00'), false, now), 'done yesterday').to.equal(false)
    expect(needsNextBookingFlag('confirmed', now, false, now), 'still to come').to.equal(false)
    expect(needsNextBookingFlag('arrived', now, false, now)).to.equal(false)
  })
  it('never flags a patient who has another booking', () => {
    expect(needsNextBookingFlag('withp', now, true, now)).to.equal(false)
  })
})

describe('Counts row', () => {
  it('counts per filter and adds each debtor once', () => {
    const r = stageCounts([
      { stage: 'pending', patientId: 'a', owesCents: 0 },
      { stage: 'online', patientId: 'b', owesCents: 4500 },
      { stage: 'arrived', patientId: 'c', owesCents: 1000 },
      { stage: 'completed', patientId: 'c', owesCents: 1000 }, // same patient, second visit
      { stage: 'cancelled', patientId: 'd', owesCents: 9900 }, // off the grid, off the count
    ])
    expect(r.total).to.equal(4)
    expect(r.counts.pending, 'online counts as unconfirmed').to.equal(2)
    expect(r.counts.arrived).to.equal(1)
    expect(r.counts.owes).to.equal(2)
    expect(r.owedCents).to.equal(5500)
  })
  it('matches a filter the way the counts do', () => {
    expect(matchesFilter('pending', 'online', 0)).to.equal(true)
    expect(matchesFilter('owes', 'confirmed', 1)).to.equal(true)
    expect(matchesFilter('owes', 'confirmed', 0)).to.equal(false)
    expect(matchesFilter('withp', 'arrived', 0)).to.equal(false)
  })
})

describe('Block ladder', () => {
  const base: LadderInput = {
    density: 'day',
    width: 340,
    height: 56,
    stage: 'arrived',
    owes: true,
    bono: true,
    note: true,
    moved: 2,
    noNext: false,
    pillText: 'Llegó 17:36',
    owesText: 'Debe 45,00 €',
    bonoText: 'Bono 3/10',
  }

  it('fits everything on a roomy day block', () => {
    const l = blockLadder(base)
    expect(l.compact).to.equal(false)
    expect(l.pill).to.equal('label')
    expect(l.owes).to.equal('meta')
    expect(l.meta).to.equal('full')
    expect(l.note && l.bono && l.moved).to.equal(true)
  })

  it('collapses a block under 40px to one line, with the money still on it', () => {
    const l = blockLadder({ ...base, height: 26 })
    expect(l.compact).to.equal(true)
    expect(l.owes).to.equal('inline')
    expect(l.meta).to.equal('none')
    expect(l.bono || l.moved || l.noNext).to.equal(false)
  })

  it('drops from the bottom of the ladder first, never the money', () => {
    const l = blockLadder({ ...base, width: 180, noNext: true })
    expect(l.owes).to.equal('meta')
    expect(l.pill, 'narrow: icon only').to.equal('icon')
    expect(l.noNext, 'rank 8 goes first').to.equal(false)
    expect(l.moved, 'rank 7 next').to.equal(false)
  })

  it('wraps rather than drops on a tall block', () => {
    const l = blockLadder({ ...base, width: 180, height: 110, noNext: true })
    expect(l.wrap).to.equal(true)
    expect(l.bono && l.moved && l.noNext).to.equal(true)
  })

  it('draws week blocks with a short name, an icon and a € dot only', () => {
    const l = blockLadder({ ...base, density: 'week', width: 82, height: 59 })
    expect(l.shortName).to.equal(true)
    expect(l.pill).to.equal('icon')
    expect(l.owes).to.equal('dot')
    expect(l.meta).to.equal('time')
    expect(l.note || l.bono || l.moved).to.equal(false)
    expect(blockLadder({ ...base, density: 'week', stage: 'confirmed' }).pill, 'confirmed is the default in week').to.equal('none')
  })

  it('shows no pill on a finished visit', () => {
    expect(blockLadder({ ...base, stage: 'completed' }).pill).to.equal('none')
  })

  it('shortens a name to initial and first surname', () => {
    expect(shortPatientName('Laura', 'Gómez Pardo')).to.equal('L. Gómez')
    expect(shortPatientName('Laura', null)).to.equal('Laura')
  })
})

describe('Hatching: when anybody works', () => {
  const wed = new Date('2026-09-23T12:00:00')
  it('merges overlapping windows', () => {
    expect(mergeWindows([['15:00', '20:00'], ['09:00', '14:00'], ['13:30', '15:30']])).to.deep.equal([['09:00', '20:00']])
    expect(mergeWindows([['09:00', '13:00'], ['16:00', '20:00']])).to.deep.equal([['09:00', '13:00'], ['16:00', '20:00']])
  })
  it('opens an hour if any one practitioner works it', () => {
    const marta = { wed: [['09:00', '14:00']] as [string, string][] }
    const javier = { wed: [['15:00', '20:00']] as [string, string][] }
    expect(unionWorkingWindows(wed, null, [marta, javier])).to.deep.equal([['09:00', '14:00'], ['15:00', '20:00']])
  })
  it('lends the clinic hours to someone who never set their own', () => {
    const clinic = { wed: [['10:00', '18:00']] as [string, string][] }
    expect(unionWorkingWindows(wed, clinic, [null])).to.deep.equal([['10:00', '18:00']])
  })
  it('hatches nothing when nobody configured anything', () => {
    // One practitioner with no hours and no clinic hours to borrow: nothing
    // says when they are off, so nothing is closed.
    expect(unionWorkingWindows(wed, null, [{ wed: [['09:00', '14:00']] }, null])).to.equal(null)
    expect(unionWorkingWindows(wed, null, [])).to.equal(null)
  })
})

describe('Bono on a block', () => {
  const pack = { package_name: 'Bono 10', sessions_total: 10, sessions_used: 7 }
  it('uses the drawn session when there is one', () => {
    expect(bonoForVisit({ kind: 'bono', packageName: 'Bono 12', remaining: 4, total: 12, reference: null }, pack)).to.deep.equal({ packageName: 'Bono 12', remaining: 4, total: 12, drawn: true })
  })
  it('names the pack a future visit will draw from', () => {
    expect(bonoForVisit({ kind: 'none' }, pack)).to.deep.equal({ packageName: 'Bono 10', remaining: 3, total: 10, drawn: false })
  })
  it('names no bono beside a visit that was charged instead', () => {
    expect(bonoForVisit({ kind: 'unpaid', invoiceNumber: 'INV-1', totalCents: 4500 }, pack)).to.equal(null)
    expect(bonoForVisit({ kind: 'settled', methods: ['card'], facturaNumber: null, invoiceNumber: 'INV-2' }, pack)).to.equal(null)
  })
  it('ignores a used-up pack', () => {
    expect(bonoForVisit({ kind: 'none' }, { ...pack, sessions_used: 10 })).to.equal(null)
  })
})
