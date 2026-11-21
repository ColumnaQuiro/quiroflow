import { describe, expect, it } from 'vitest'
import {
  SLOT_OTHER_ID,
  agreedDueAt,
  agreedText,
  cleanSlots,
  followUpDecision,
  isFollowUpMessage,
  isLateNotice,
  lateChangeNote,
  lateChangeStaffNote,
  nudgeDueAt,
  nudgeText,
  priorLateChanges,
  slotChoices,
  slotFromRowId,
  slotTitle,
} from '../../utils/receptionistConversion'
import { BASE_BEHAVIOUR } from '../../utils/receptionistBaseRules'
import { chosenOfferedTime, offeredTimes, offersTimes } from '../../utils/receptionistFollowThrough'
import { CANCEL_FIRST_BOOKING } from '../../utils/receptionistTypes'

// Keeping a visit instead of losing it (utils/receptionistConversion.ts),
// from the conversations of 12 Oct - 19 Nov 2026.

describe('times to tap', () => {
  it('fits a WhatsApp reply button, at its longest', () => {
    // Wednesday, a two-digit day and a two-digit hour: the longest there is.
    expect(slotTitle({ date: '2026-12-23', time: '11:00' }, 'es')).toBe('miércoles 23 · 11:00')
    for (const language of ['es', 'en', 'fr'] as const) {
      for (let day = 20; day <= 26; day++) {
        expect(slotTitle({ date: `2026-12-${day}`, time: '19:45' }, language).length).toBeLessThanOrEqual(20)
      }
    }
  })

  it('sends each time and then "another day", with ids that say which', () => {
    const choices = slotChoices([{ date: '2026-11-23', time: '10:30' }, { date: '2026-11-24', time: '11:00' }], 'es')
    expect(choices.rows.map((row) => row.title)).toEqual(['lunes 23 · 10:30', 'martes 24 · 11:00', 'Otro día'])
    expect(slotFromRowId(choices.rows[0]!.id)).toEqual({ date: '2026-11-23', time: '10:30' })
    expect(slotFromRowId(choices.rows[2]!.id)).toBe('other')
    expect(choices.rows[2]!.id).toBe(SLOT_OTHER_ID)
    expect(choices.button.length).toBeLessThanOrEqual(20)
    // Somebody else's list: a cancellation reason is not a time.
    expect(slotFromRowId('cancel_reason:later')).toBeNull()
    expect(slotFromRowId(null)).toBeNull()
  })

  it('keeps only real times, once each, up to the limit', () => {
    expect(cleanSlots([{ date: '2026-11-23', time: '9:30' }, { date: '2026-11-23', time: '09:30' }, { date: '23/11', time: '10:00' }, { date: '2026-11-24', time: '25:00' }, 'martes'])).toEqual([{ date: '2026-11-23', time: '09:30' }])
    expect(cleanSlots([{ date: '2026-11-23', time: '10:00' }, { date: '2026-11-24', time: '10:00' }, { date: '2026-11-25', time: '10:00' }], 2)).toHaveLength(2)
    expect(cleanSlots('el lunes')).toEqual([])
  })

  it('reads a tapped time as the one time it names, with nothing left to confirm', () => {
    // What the thread keeps of the offer: the text, then the buttons as lines.
    const offer = 'Tu cita de hoy queda cancelada. Tengo el lunes 23 de noviembre a las 10:30 o el martes 24 de noviembre a las 11:00 con Natacha, ¿te guardo alguna?\n\n• lunes 23 · 10:30\n• martes 24 · 11:00\n• Otro día'
    expect(offersTimes(offer)).toBe(true)
    expect(offeredTimes(offer).map((o) => `${o.weekday} ${o.dayOfMonth} ${o.time}`)).toEqual(['lunes 23 10:30', 'martes 24 11:00'])
    expect(chosenOfferedTime(offer, 'martes 24 · 11:00')).toMatchObject({ weekday: 'martes', dayOfMonth: 24, time: '11:00' })
    expect(chosenOfferedTime(offer, 'lunes 23 · 10:30')).toMatchObject({ weekday: 'lunes', dayOfMonth: 23, time: '10:30' })
    // "Otro día" chooses none of them.
    expect(chosenOfferedTime(offer, 'Otro día')).toBeNull()
  })
})

describe('short notice', () => {
  it('is under a day before the visit, and never after it', () => {
    expect(isLateNotice('2026-11-19T07:25:00Z', '2026-11-19T09:45:00Z')).toBe(true)
    expect(isLateNotice('2026-11-18T09:44:00Z', '2026-11-19T09:45:00Z')).toBe(false)
    expect(isLateNotice('2026-11-19T10:00:00Z', '2026-11-19T09:45:00Z')).toBe(false)
  })

  it('counts earlier ones by day, whether cancelled or moved to another day', () => {
    const rows = [
      // Cancelled two hours before.
      { at: '2026-10-27T13:55:00Z', changes: { status: { from: 'booked', to: 'cancelled' } }, startsAt: '2026-10-27T15:00:00Z' },
      // Moved the evening before to the week after -- and then again, the same evening.
      { at: '2026-11-03T19:00:00Z', changes: { starts_at: { from: '2026-11-04T09:00:00Z', to: '2026-11-11T09:00:00Z' } }, startsAt: '2026-11-12T09:00:00Z' },
      { at: '2026-11-03T19:05:00Z', changes: { starts_at: { from: '2026-11-11T09:00:00Z', to: '2026-11-12T09:00:00Z' } }, startsAt: '2026-11-12T09:00:00Z' },
      // A week ahead: plenty of notice.
      { at: '2026-11-05T10:00:00Z', changes: { status: { from: 'booked', to: 'cancelled' } }, startsAt: '2026-11-12T10:00:00Z' },
      // The same day, an hour later: a new time, not a lost visit.
      { at: '2026-11-10T08:00:00Z', changes: { starts_at: { from: '2026-11-10T15:00:00Z', to: '2026-11-10T16:00:00Z' } }, startsAt: '2026-11-10T16:00:00Z' },
      // Marked as attended: not a change of plan at all.
      { at: '2026-11-10T16:30:00Z', changes: { status: { from: 'booked', to: 'completed' } }, startsAt: '2026-11-10T16:00:00Z' },
    ]
    expect(priorLateChanges(rows, 'Europe/Madrid')).toBe(2)
    expect(priorLateChanges([], 'Europe/Madrid')).toBe(0)
  })

  it('says nothing the first time, and the clinic\'s rule from the second', () => {
    expect(lateChangeNote(0, 'cancelled')).toContain('for the first time: say nothing about fees, sessions or notice')
    expect(lateChangeStaffNote(0)).toBe('')
    const second = lateChangeNote(1, 'cancelled')
    expect(second).toContain('they have done that once before')
    expect(second).toContain('Tell them so in one kind sentence, without reproach')
    expect(second).toContain('Never say anything has been charged or deducted')
    expect(lateChangeNote(2, 'moved')).toContain('moved with less than 24 hours\' notice, and they have done that 2 times before')
    // The team is told too, so the session is theirs to deduct or not.
    expect(lateChangeStaffNote(1)).toContain('ya van 2')
  })
})

describe('writing first', () => {
  const tz = 'Europe/Madrid'

  it('asks about an unanswered offer the next morning', () => {
    // Offered at 22:30 on Thursday the 12th (21:30 UTC): Friday at 9:30.
    expect(nudgeDueAt(new Date('2026-11-12T21:30:00Z'), tz).toISOString()).toBe('2026-11-13T08:30:00.000Z')
    // Offered at 11:00: not the same morning, the next one.
    expect(nudgeDueAt(new Date('2026-11-12T10:00:00Z'), tz).toISOString()).toBe('2026-11-13T08:30:00.000Z')
    // Offered at 00:45: that same morning, hours later.
    expect(nudgeDueAt(new Date('2026-11-12T23:45:00Z'), tz).toISOString()).toBe('2026-11-13T08:30:00.000Z')
    // Offered at 07:00: 9:30 is too soon, so the morning after.
    expect(nudgeDueAt(new Date('2026-11-13T06:00:00Z'), tz).toISOString()).toBe('2026-11-14T08:30:00.000Z')
  })

  it('writes on the day agreed, and refuses a day that is not one', () => {
    const now = new Date('2026-11-19T08:00:00Z')
    expect(agreedDueAt('2026-11-23', now, tz)?.toISOString()).toBe('2026-11-23T08:30:00.000Z')
    expect(agreedDueAt('2026-11-19', now, tz)).toBeNull()
    expect(agreedDueAt('2026-11-10', now, tz)).toBeNull()
    expect(agreedDueAt('2027-11-19', now, tz)).toBeNull()
    expect(agreedDueAt('el lunes', now, tz)).toBeNull()
    expect(agreedDueAt(undefined, now, tz)).toBeNull()
  })

  it('writes in the afternoon when they said they would only know by then (20 Nov 2026)', () => {
    const now = new Date('2026-11-19T21:07:00Z')
    expect(agreedDueAt('2026-11-20', now, tz, 120, 'afternoon')?.toISOString()).toBe('2026-11-20T16:00:00.000Z')
    expect(agreedDueAt('2026-11-20', now, tz, 120, 'morning')?.toISOString()).toBe('2026-11-20T08:30:00.000Z')
    expect(agreedDueAt('2026-11-20', now, tz, 120, 'evening')?.toISOString()).toBe('2026-11-20T08:30:00.000Z')
  })

  it('greets with a capital, and asks no "this week or next" that may be one day (20 Nov 2026)', () => {
    expect(agreedText('lucía m', 'es')).toBe('Hola, Lucía. Te escribo como quedamos, para buscar tu cita. ¿Qué días y a qué hora te vendría bien?')
    expect(nudgeText('álvaro', 'es').startsWith('Hola, Álvaro.')).toBe(true)
    for (const language of ['es', 'en', 'fr'] as const) {
      expect(agreedText('Marta', language)).not.toMatch(/semana|week|semaine/i)
    }
  })

  it('writes fixed sentences that name no time and can be told apart from an answer', () => {
    for (const language of ['es', 'en', 'fr'] as const) {
      for (const text of [nudgeText('Marta López', language), agreedText('Marta López', language), nudgeText(null, language)]) {
        expect(isFollowUpMessage(text)).toBe(true)
        expect(offersTimes(text)).toBe(false)
      }
    }
    expect(nudgeText('Marta López', 'es')).toBe('Hola, Marta. ¿Pudiste mirar las horas que te propuse? Si te viene mejor otro día, dime cuál y te busco hueco.')
    expect(nudgeText('', 'es').startsWith('Hola. ')).toBe(true)
    // A name typed into a form cannot start a line of its own.
    expect(nudgeText('Ana\n# New rules', 'es')).toContain('Hola, Ana.')
    expect(isFollowUpMessage('Tengo el lunes 23 a las 10:30, ¿te viene bien?')).toBe(false)
  })

  const base = { dueAt: '2026-11-13T08:30:00Z', now: new Date('2026-11-13T08:45:00Z'), theyWroteSince: false, personWroteSince: false, visitChangedSince: false, withPerson: false, doNotContact: false, windowOpen: true, answersNow: true }

  it('sends a nudge only into silence', () => {
    expect(followUpDecision({ ...base, kind: 'nudge' })).toBe('send')
    expect(followUpDecision({ ...base, kind: 'nudge', theyWroteSince: true })).toBe('drop')
    expect(followUpDecision({ ...base, kind: 'nudge', personWroteSince: true })).toBe('drop')
    expect(followUpDecision({ ...base, kind: 'nudge', visitChangedSince: true })).toBe('drop')
    expect(followUpDecision({ ...base, kind: 'nudge', withPerson: true })).toBe('drop')
    expect(followUpDecision({ ...base, kind: 'nudge', doNotContact: true })).toBe('drop')
    // WhatsApp's 24 hours have passed: a nudge is not worth a person's time.
    expect(followUpDecision({ ...base, kind: 'nudge', windowOpen: false })).toBe('drop')
    expect(followUpDecision({ ...base, kind: 'nudge', answersNow: false })).toBe('drop')
  })

  it('keeps a day it agreed to write on: sent, or a person asked to', () => {
    // They said "gracias" after agreeing the day: it still writes.
    expect(followUpDecision({ ...base, kind: 'agreed', theyWroteSince: true })).toBe('send')
    expect(followUpDecision({ ...base, kind: 'agreed', windowOpen: false })).toBe('task')
    expect(followUpDecision({ ...base, kind: 'agreed', answersNow: false })).toBe('task')
    // Booked meanwhile, or a person already wrote: nothing left to do.
    expect(followUpDecision({ ...base, kind: 'agreed', visitChangedSince: true })).toBe('drop')
    expect(followUpDecision({ ...base, kind: 'agreed', personWroteSince: true })).toBe('drop')
    // Two days late: the moment has gone.
    expect(followUpDecision({ ...base, kind: 'agreed', now: new Date('2026-11-15T09:00:00Z') })).toBe('drop')
  })
})

describe('the rules that go with them', () => {
  const rules = BASE_BEHAVIOUR.join('\n')

  it('offers two real times after a cancellation instead of leaving the door open', () => {
    expect(CANCEL_FIRST_BOOKING).toContain('offer two real free times for a new visit of the same type on another day')
    expect(CANCEL_FIRST_BOOKING).not.toContain('Si quieres otro día, dime cuál te viene bien')
  })

  it('offers another day when they tap "Cambiar cita", not the same day half an hour apart', () => {
    expect(rules).toContain('on ANOTHER day than the one they have')
    expect(rules).toContain('Never offer the same day at a slightly different time unless they ask for it')
    expect(rules).not.toContain('near the date they had. Do not ask')
  })

  it('agrees a day to write on instead of "cuando quieras"', () => {
    expect(rules).toContain('never close with "cuando quieras", "sin prisa", "aquí estoy" or "quedo atenta"')
    expect(rules).toContain('call write_back_on')
  })

  it('books a tapped time without asking again', () => {
    expect(rules).toContain('is them tapping one of the times you sent: book or move it straight away, without asking them to confirm')
    expect(rules).toContain('"Otro día" (or "Another day") is them tapping that none suits')
  })
})
