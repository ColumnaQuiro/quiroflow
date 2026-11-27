import { describe, it, expect } from 'vitest'
import { appointmentStage, isUnconfirmedStage, matchesFilter, needsNextBookingFlag, nextStep, pendingFormsFlag, stageCounts, trackIndex, type StageInput } from '../../utils/appointmentStage'
import { blockLadder, fullerPatientNames, practitionerBadgeLabels, shortPatientName, type LadderInput } from '../../utils/appointmentBlock'
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

  describe('a staff booking nobody has asked about yet', () => {
    const now = new Date('2026-11-12T10:00:00.000Z')
    const reminders = { enabled: true, daysBefore: 1, timeZone: 'Europe/Madrid' }
    // Thursday next week, booked a month ago: its reminder is days away.
    const nextWeek = { ...booked, starts_at: '2026-11-19T09:00:00.000Z', created_at: '2026-10-07T07:26:00.000Z', confirmation_sent_at: null, reminder_claimed_at: null, rescheduled: false }

    it('is unconfirmed while the clinic reminder is still to come', () => {
      expect(appointmentStage(nextWeek, reminders, now)).to.equal('pending')
    })

    it('is unconfirmed when its reminder is due on the next tick (tomorrow\'s visit, after 10:00 today)', () => {
      expect(appointmentStage({ ...nextWeek, starts_at: '2026-11-13T09:00:00.000Z' }, reminders, now)).to.equal('pending')
    })

    it('is confirmed at a clinic with reminders switched off', () => {
      expect(appointmentStage(nextWeek, { enabled: false, daysBefore: 1, timeZone: 'Europe/Madrid' }, now)).to.equal('confirmed')
    })

    it('is confirmed when no reminder will go: booked at the desk an hour before', () => {
      expect(appointmentStage({ ...nextWeek, starts_at: '2026-11-12T11:00:00.000Z', created_at: '2026-11-12T09:55:00.000Z' }, reminders, now)).to.equal('confirmed')
    })

    it('is confirmed once the reminder was dealt with and nothing came of it', () => {
      // Claimed but never marked pending: no channel reached the patient.
      expect(appointmentStage({ ...nextWeek, reminder_claimed_at: '2026-11-11T09:00:00.000Z' }, reminders, now)).to.equal('confirmed')
    })

    it('reads as before when the caller has not loaded the setting', () => {
      expect(appointmentStage(nextWeek, null, now)).to.equal('confirmed')
      expect(appointmentStage(booked, reminders, now)).to.equal('confirmed')
    })

    it('still lets an answer or an arrival decide', () => {
      expect(appointmentStage({ ...nextWeek, confirmation_status: 'confirmed' }, reminders, now)).to.equal('confirmed')
      expect(appointmentStage({ ...nextWeek, checked_in_at: at }, reminders, now)).to.equal('arrived')
      expect(appointmentStage({ ...nextWeek, source: 'online' }, reminders, now)).to.equal('online')
    })
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

describe('Pending forms on a visit', () => {
  const now = new Date('2026-10-20T10:00:00')
  it('flags a visit from today on that the patient has not reached the room for', () => {
    expect(pendingFormsFlag('pending', '2026-10-22T09:00:00', 2, now)).to.equal(2)
    expect(pendingFormsFlag('confirmed', '2026-10-20T08:00:00', 1, now), 'earlier today').to.equal(1)
    expect(pendingFormsFlag('arrived', '2026-10-20T10:00:00', 1, now), 'in reception: a tablet can still fix it').to.equal(1)
    expect(pendingFormsFlag('online', '2026-10-21T09:00:00', 1, now)).to.equal(1)
  })
  it('says nothing once it is too late, or when nothing is pending', () => {
    expect(pendingFormsFlag('confirmed', '2026-10-19T09:00:00', 1, now), 'a past day').to.equal(0)
    expect(pendingFormsFlag('withp', '2026-10-20T10:00:00', 1, now)).to.equal(0)
    expect(pendingFormsFlag('completed', '2026-10-20T09:00:00', 1, now)).to.equal(0)
    expect(pendingFormsFlag('cancelled', '2026-10-22T09:00:00', 1, now)).to.equal(0)
    expect(pendingFormsFlag('noshow', '2026-10-20T09:00:00', 1, now)).to.equal(0)
    expect(pendingFormsFlag('confirmed', '2026-10-22T09:00:00', 0, now)).to.equal(0)
    expect(pendingFormsFlag('confirmed', '2026-10-22T09:00:00', null, now), 'not loaded').to.equal(0)
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
    expect(l.moved, 'rank 8 goes first').to.equal(false)
  })

  it('wraps rather than drops on a tall block', () => {
    const l = blockLadder({ ...base, width: 180, height: 110, noNext: true })
    expect(l.wrap).to.equal(true)
    expect(l.bono && l.moved && l.noNext).to.equal(true)
  })

  it('flags "no next visit" as an icon beside the name, on any block with room', () => {
    // A 30-minute visit: one line. The flag used to be a chip on the detail
    // line, so a block this size never showed it.
    const one = blockLadder({ ...base, height: 30, owes: false, note: false, noNext: true, nameText: 'Laura Gómez', pillText: 'Con el profesional' })
    expect(one.compact).to.equal(true)
    expect(one.noNext).to.equal(true)
    expect(blockLadder({ ...base, noNext: false }).noNext, 'only when it applies').to.equal(false)
    // Room for one icon beside name and label: the forms outrank it, it outranks the note.
    const tight = blockLadder({ ...base, width: 200, owes: false, noNext: true, nameText: 'Laura Gómez', pillText: 'Llegó' })
    expect(tight.noNext).to.equal(true)
    expect(tight.note).to.equal(false)
    const withForms = blockLadder({ ...base, width: 200, owes: false, forms: true, noNext: true, nameText: 'Laura Gómez', pillText: 'Llegó' })
    expect(withForms.forms).to.equal(true)
    expect(withForms.noNext).to.equal(false)
  })

  it('flags "no next visit" in week view where the short name leaves room', () => {
    const week = { ...base, density: 'week' as const, height: 59, stage: 'completed' as const, noNext: true, nameText: 'L. Gómez' }
    expect(blockLadder({ ...week, width: 120 }).noNext).to.equal(true)
    expect(blockLadder({ ...week, width: 70 }).noNext, 'never at the cost of the name').to.equal(false)
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

  it('shrinks the stage label to its icon before it would cut the name', () => {
    // 215px is a room column on an iPad in landscape. "Online · sin
    // confirmar" beside "Sergio Navarro" does not fit; the name wins.
    const spanish = { ...base, width: 215, stage: 'online' as const, owes: false, note: false, pillText: 'Online · sin confirmar' }
    expect(blockLadder({ ...spanish, nameText: 'Sergio Navarro' }).pill).to.equal('icon')
    const pending = { ...spanish, stage: 'pending' as const, pillText: 'Sin confirmar' }
    expect(blockLadder({ ...pending, nameText: 'Sergio Navarro' }).pill).to.equal('icon')
    expect(blockLadder({ ...pending, nameText: 'Ana Gil' }).pill, 'a short name leaves room').to.equal('label')
    expect(blockLadder({ ...spanish, width: 340, nameText: 'Sergio Navarro' }).pill, 'a wide column has room for both').to.equal('label')
  })

  it('puts pending forms beside the name, ahead of the clinical note', () => {
    expect(blockLadder({ ...base, forms: true, nameText: 'Laura Gómez' }).forms).to.equal(true)
    expect(blockLadder(base).forms, 'nothing pending, no icon').to.equal(false)
    // Room for one icon beside name and label: the forms take it.
    const tight = blockLadder({ ...base, width: 200, owes: false, forms: true, nameText: 'Laura Gómez', pillText: 'Llegó' })
    expect(tight.forms).to.equal(true)
    expect(tight.note).to.equal(false)
  })

  it('draws the re-exam marker before the forms icon, and the forms before the note', () => {
    // Both on one block: the marker (rank 2½) always, the forms where line one still has room.
    const both = blockLadder({ ...base, marker: true, forms: true, nameText: 'Laura Gómez' })
    expect(both.marker && both.forms).to.equal(true)
    const line = { ...base, owes: false, marker: true, forms: true, nameText: 'Laura Gómez', pillText: 'Llegó' }
    // Room for one icon beside name and label: the marker outranks the forms.
    const tight = blockLadder({ ...line, width: 200 })
    expect(tight.marker, 'the marker is never dropped').to.equal(true)
    expect(tight.forms).to.equal(false)
    const roomy = blockLadder({ ...line, width: 240 })
    expect(roomy.marker && roomy.forms && roomy.note, 'wider: all three').to.equal(true)
    // Week: the marker takes the room a confirmed visit left the forms icon.
    const week = { ...base, density: 'week' as const, width: 82, height: 59, stage: 'confirmed' as const, forms: true, nameText: 'L. Gómez' }
    expect(blockLadder(week).forms).to.equal(true)
    const weekBoth = blockLadder({ ...week, marker: true })
    expect(weekBoth.marker).to.equal(true)
    expect(weekBoth.forms, 'the name keeps its room').to.equal(false)
  })

  it('shows pending forms in week view only where the short name keeps its room', () => {
    const week = { ...base, density: 'week' as const, height: 59, forms: true, nameText: 'L. Gómez' }
    expect(blockLadder({ ...week, width: 82, stage: 'confirmed' }).forms, 'no stage icon: room').to.equal(true)
    expect(blockLadder({ ...week, width: 82, stage: 'pending' }).forms, 'stage icon: the name wins').to.equal(false)
    expect(blockLadder({ ...week, width: 140, stage: 'pending' }).forms, 'a wider column fits both').to.equal(true)
  })

  it('shows no pill on a finished visit', () => {
    expect(blockLadder({ ...base, stage: 'completed' }).pill).to.equal('none')
  })

  it('shortens a name to initial and first surname', () => {
    expect(shortPatientName('Laura', 'Gómez Pardo')).to.equal('L. Gómez')
    expect(shortPatientName('Laura', null)).to.equal('Laura')
  })

  it('keeps a surname\'s particles with it', () => {
    expect(shortPatientName('Laura', 'de la Fuente Ruiz')).to.equal('L. de la Fuente')
    expect(fullerPatientNames('Laura', 'de la Fuente Ruiz')).to.deep.equal(['Laura de la Fuente Ruiz', 'Laura de la Fuente'])
    expect(shortPatientName('Laura', 'De')).to.equal('L. De')
  })

  it('lists a name from most to least complete', () => {
    expect(fullerPatientNames('Laura', 'Gómez Pardo')).to.deep.equal(['Laura Gómez Pardo', 'Laura Gómez'])
    expect(fullerPatientNames('Laura', 'Gómez'), 'one surname is one form').to.deep.equal(['Laura Gómez'])
    expect(fullerPatientNames('Laura', null)).to.deep.equal([])
  })

  it('prints the fullest name a week column has room for', () => {
    const week = { ...base, density: 'week' as const, height: 30, stage: 'confirmed' as const, owes: false, nameText: 'L. Gómez', firstName: 'Laura', lastName: 'Gómez Pardo' }
    expect(blockLadder({ ...week, width: 160 }).fullerName, 'first name and both surnames').to.equal('Laura Gómez Pardo')
    expect(blockLadder({ ...week, width: 100 }).fullerName, 'first name and first surname').to.equal('Laura Gómez')
    const narrow = blockLadder({ ...week, width: 70 })
    expect(narrow.fullerName, 'one line: the short form rather than a cut-off long one').to.equal(null)
    expect(narrow.nameLines).to.equal(null)
    expect(narrow.shortName).to.equal(true)
    // A stage icon, the re-exam marker and the red flag are drawn first.
    expect(blockLadder({ ...week, width: 150 }).fullerName).to.equal('Laura Gómez Pardo')
    expect(blockLadder({ ...week, width: 150, stage: 'arrived', marker: true, redFlag: true }).fullerName).to.equal('Laura Gómez')
    expect(blockLadder({ ...week, width: 160, firstName: undefined, lastName: undefined }).shortName, 'a caller that sends no parts keeps the short name').to.equal(true)
  })

  it('keeps a week icon rather than print a longer name', () => {
    const week = { ...base, density: 'week' as const, height: 30, stage: 'completed' as const, noNext: true, nameText: 'L. Gómez', firstName: 'Laura', lastName: 'Gómez Pardo' }
    const l = blockLadder({ ...week, width: 120 })
    expect(l.noNext).to.equal(true)
    expect(l.fullerName).to.equal('Laura Gómez')
  })

  it('gives a narrow week block\'s name two lines, and keeps the time where there are three', () => {
    // A day split into room columns: some 70px a block.
    const week = { ...base, density: 'week' as const, width: 71, stage: 'pending' as const, owes: false, nameText: 'L. Gómez', firstName: 'Laura', lastName: 'Gómez Pardo' }
    const halfHour = blockLadder({ ...week, height: 46 })
    expect(halfHour.nameLines).to.deep.equal(['Laura', 'Gómez Pardo'])
    expect(halfHour.shortName).to.equal(false)
    expect(halfHour.meta, 'the time stays').to.equal('time')
    expect(halfHour.tight).to.equal(true)
    const hour = blockLadder({ ...week, height: 94 })
    expect(hour.nameLines).to.deep.equal(['Laura', 'Gómez Pardo'])
    expect(hour.tight).to.equal(false)
    const short = blockLadder({ ...week, height: 41 })
    expect(short.nameLines, 'two lines only: the name outranks the time').to.deep.equal(['Laura', 'Gómez Pardo'])
    expect(short.meta).to.equal('none')
    // The badge always stays, and it lives on the time's line.
    const badged = blockLadder({ ...week, height: 41, badgeText: 'L' })
    expect(badged.nameLines).to.equal(null)
    expect(badged.badge).to.equal('meta')
    expect(blockLadder({ ...week, height: 46, badgeText: 'L' }).nameLines).to.deep.equal(['Laura', 'Gómez Pardo'])
    expect(blockLadder({ ...week, height: 46, lastName: undefined }).nameLines, 'no surname on record').to.equal(null)
  })

  it('always draws the practitioner badge it is given, and nothing without one', () => {
    expect(blockLadder(base).badge, 'not the whole-clinic tab').to.equal('none')
    expect(blockLadder({ ...base, badgeText: 'L' }).badge).to.equal('name')
    expect(blockLadder({ ...base, badgeText: 'L', height: 26 }).badge, 'one-line block').to.equal('name')
    expect(blockLadder({ ...base, badgeText: 'L', density: 'week', width: 60, height: 26 }).badge, 'one-line week block').to.equal('name')
  })

  it('takes the badge out of the name line, not the detail line', () => {
    // At 300px "Online · sin confirmar" fits beside "Sergio Navarro" only
    // without a badge taking 22px of the same line.
    const online = { ...base, width: 300, stage: 'online' as const, owes: false, note: false, pillText: 'Online · sin confirmar', nameText: 'Sergio Navarro' }
    expect(blockLadder(online).pill).to.equal('label')
    expect(blockLadder({ ...online, badgeText: 'L' }).pill, 'the name keeps its room').to.equal('icon')
    // Line two is untouched: everything that fitted there still does.
    const plain = blockLadder({ ...base, width: 260 })
    const badged = blockLadder({ ...base, width: 260, badgeText: 'LM' })
    expect([badged.meta, badged.bono, badged.moved]).to.deep.equal([plain.meta, plain.bono, plain.moved])
  })

  it('leads a two-line week block\'s time with the badge, so the short name keeps its room', () => {
    // 71px: a work week split into three rooms and "Sin asignar" at 1440px.
    const week = { ...base, density: 'week' as const, height: 59, nameText: 'P. Mateu', stage: 'confirmed' as const }
    expect(blockLadder({ ...week, width: 71 }).meta, 'no badge: the time as before').to.equal('time')
    const narrow = blockLadder({ ...week, width: 71, badgeText: 'S' })
    expect(narrow.badge).to.equal('meta')
    expect(narrow.meta, 'the axis has the time').to.equal('none')
    expect(blockLadder({ ...week, width: 120, badgeText: 'S' }).meta, 'room for both').to.equal('time')
  })

  it('keeps a 30-minute week visit on two lines when it carries a badge', () => {
    const week = { ...base, density: 'week' as const, height: 38, width: 71, nameText: 'P. Mateu', stage: 'confirmed' as const }
    expect(blockLadder(week).compact, 'no badge: one line, as before').to.equal(true)
    const badged = blockLadder({ ...week, badgeText: 'S' })
    expect(badged.compact).to.equal(false)
    expect(badged.badge, 'beside the time, not the name').to.equal('meta')
    expect(blockLadder({ ...week, height: 20, badgeText: 'S' }).badge, 'a 15-minute visit: one line, the badge first').to.equal('name')
  })

  it('makes room for the badge before the forms icon only on a one-line week block', () => {
    const week = { ...base, density: 'week' as const, height: 26, forms: true, nameText: 'L. Gómez', stage: 'confirmed' as const }
    expect(blockLadder({ ...week, width: 82 }).forms).to.equal(true)
    expect(blockLadder({ ...week, width: 82, badgeText: 'L' }).forms, 'the badge outranks the forms').to.equal(false)
    expect(blockLadder({ ...week, width: 82, height: 59, badgeText: 'L' }).forms, 'two lines: the badge is not on the name line').to.equal(true)
  })
})

describe('A narrow week block (a clinic with many rooms, the week fitted to the screen)', () => {
  const narrow: LadderInput = {
    density: 'week',
    width: 30,
    height: 24,
    stage: 'arrived',
    owes: true,
    bono: true,
    note: true,
    moved: 2,
    noNext: true,
    forms: true,
    marker: true,
    pillText: 'Llegó',
    nameText: 'L. Gómez',
    firstName: 'Laura',
    lastName: 'Gómez Pardo',
  }

  it('is narrow under 56px, and only there', () => {
    expect(blockLadder({ ...narrow, width: 55 }).narrow).to.equal(true)
    expect(blockLadder({ ...narrow, width: 56 }).narrow).to.equal(false)
    expect(blockLadder({ ...narrow, density: 'day' }).narrow, 'never in the day view').to.equal(false)
  })

  it('prints the first name where it fits, else the initials', () => {
    // 41px leaves 35 for "Laura" at 6.6px a letter (33).
    expect(blockLadder({ ...narrow, width: 41 }).narrowName).to.equal('Laura')
    expect(blockLadder({ ...narrow, width: 30 }).narrowName).to.equal('LG')
  })

  it('puts the surnames under the first name when the block is tall enough', () => {
    const tall = blockLadder({ ...narrow, width: 41, height: 40 })
    expect(tall.nameLines).to.deep.equal(['Laura', 'Gómez Pardo'])
    expect(tall.narrowName).to.equal(null)
    expect(blockLadder({ ...narrow, width: 30, height: 40 }).nameLines, 'no room for the first name: initials, one line').to.equal(null)
  })

  it('keeps the money and drops what has no room beside the name', () => {
    const l = blockLadder({ ...narrow, width: 41 })
    expect(l.owes).to.equal('dot')
    expect([l.pill, l.meta, l.forms, l.noNext, l.note, l.marker, l.bono, l.moved]).to.deep.equal(['none', 'none', false, false, false, false, false, false])
  })

  it('turns the practitioner badge into an edge stripe, which takes 3px rather than the name line', () => {
    expect(blockLadder(narrow).badge, 'not the whole-clinic tab').to.equal('none')
    expect(blockLadder({ ...narrow, badgeText: 'S' }).badge).to.equal('edge')
    // The stripe's 3px cost the first name at 41px, not at 44.
    expect(blockLadder({ ...narrow, width: 41, badgeText: 'S' }).narrowName).to.equal('LG')
    expect(blockLadder({ ...narrow, width: 44, badgeText: 'S' }).narrowName).to.equal('Laura')
  })

  it('runs the stripe across the top of a full week\'s 20px block, leaving the initials the whole width', () => {
    expect(blockLadder({ ...narrow, width: 18, badgeText: 'S' }).badge).to.equal('edge-top')
    expect(blockLadder({ ...narrow, width: 26, badgeText: 'S' }).badge).to.equal('edge')
    expect(blockLadder({ ...narrow, width: 18 }).badge, 'no badge asked for, no stripe').to.equal('none')
  })

  it('leaves the wider week block exactly as it was', () => {
    const wide = blockLadder({ ...narrow, width: 82, height: 59, badgeText: 'S', stage: 'confirmed' })
    expect([wide.narrow, wide.narrowName, wide.badge]).to.deep.equal([false, null, 'meta'])
  })
})

describe('Practitioner badge initials', () => {
  it('uses one letter where it is enough, two only where it is not', () => {
    const labels = practitionerBadgeLabels([
      { id: 'a', full_name: 'Léa Martin' },
      { id: 'b', full_name: 'Raúl Catalán Luis' },
      { id: 'c', full_name: 'Lucía Sanz' },
    ])
    expect(labels.get('a')).to.equal('LM')
    expect(labels.get('c')).to.equal('LS')
    expect(labels.get('b'), 'the only R').to.equal('R')
  })

  it('reads an accented letter as the same letter, and copes with a single name, extra spaces and lower case', () => {
    const labels = practitionerBadgeLabels([
      { id: 'a', full_name: '  ana ' },
      { id: 'b', full_name: 'álvaro  pérez' },
      { id: 'c', full_name: null },
    ])
    expect(labels.get('a')).to.equal('A')
    expect(labels.get('b')).to.equal('ÁP')
    expect(labels.get('c')).to.equal('?')
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
  const pack = { package_name: 'Bono 10', sessions_total: 10, sessions_used: 7, is_closed: false, purchased_at: '2026-10-01T10:00:00Z' }
  it('uses the drawn session when there is one', () => {
    expect(bonoForVisit({ kind: 'bono', packageName: 'Bono 12', remaining: 4, total: 12, reference: null }, [pack])).to.deep.equal({ packageName: 'Bono 12', remaining: 4, total: 12, drawn: true, choices: 1 })
  })
  it('names the pack a future visit will draw from', () => {
    expect(bonoForVisit({ kind: 'none' }, [pack])).to.deep.equal({ packageName: 'Bono 10', remaining: 3, total: 10, drawn: false, choices: 1 })
  })
  it('names no bono beside a visit that was charged instead', () => {
    expect(bonoForVisit({ kind: 'unpaid', invoiceNumber: 'INV-1', totalCents: 4500 }, [pack])).to.equal(null)
    expect(bonoForVisit({ kind: 'settled', methods: ['card'], facturaNumber: null, invoiceNumber: 'INV-2' }, [pack])).to.equal(null)
  })
  it('ignores a used-up pack, and one PracticeHub closed with sessions on it', () => {
    expect(bonoForVisit({ kind: 'none' }, [{ ...pack, sessions_used: 10 }])).to.equal(null)
    expect(bonoForVisit({ kind: 'none' }, [{ ...pack, is_closed: true }])).to.equal(null)
    expect(bonoForVisit({ kind: 'none' }, [])).to.equal(null)
  })
  it('counts every live pack, a shared family one as much as their own, and names the newest', () => {
    const family = { ...pack, package_name: 'Bono Familia', sessions_used: 2, purchased_at: '2026-11-01T10:00:00Z' }
    const closed = { ...pack, package_name: 'Bono Viejo', is_closed: true, purchased_at: '2026-11-10T10:00:00Z' }
    expect(bonoForVisit({ kind: 'none' }, [pack, closed, family])).to.deep.equal({ packageName: 'Bono Familia', remaining: 8, total: 10, drawn: false, choices: 2 })
  })
  it('names the drawn one once the visit has drawn, however many are live', () => {
    const family = { ...pack, package_name: 'Bono Familia' }
    expect(bonoForVisit({ kind: 'bono', packageName: 'Bono 10', remaining: 2, total: 10, reference: null }, [pack, family])?.choices).to.equal(1)
  })
})
