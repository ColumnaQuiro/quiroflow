import { describe, expect, it } from 'vitest'
import { RECALL_SNOOZE_DAYS, recallReplyIntent, snoozedUntil } from '../../utils/recallReply'

// What a reply to a recall means (the WhatsApp webhook applies it): a quick
// reply or a bare word that refuses, one that asks for later, or neither.

describe('a recall reply', () => {
  it('reads the templates\' own buttons, in either language', () => {
    expect(recallReplyIntent('No, gracias')).toBe('decline')
    expect(recallReplyIntent('No thanks')).toBe('decline')
    expect(recallReplyIntent('Más adelante')).toBe('snooze')
    expect(recallReplyIntent('Later on')).toBe('snooze')
  })

  it('reads BAJA and STOP typed by hand, whatever the case, spacing or punctuation', () => {
    expect(recallReplyIntent('BAJA')).toBe('decline')
    expect(recallReplyIntent('  stop ')).toBe('decline')
    expect(recallReplyIntent('Baja.')).toBe('decline')
    expect(recallReplyIntent('no gracias!')).toBe('decline')
    expect(recallReplyIntent('mas adelante')).toBe('snooze')
  })

  it('leaves a sentence to the desk, even one that starts the same way', () => {
    expect(recallReplyIntent('No gracias, mejor el jueves por la tarde')).toBeNull()
    expect(recallReplyIntent('Stop writing me on Mondays, Tuesdays are better')).toBeNull()
    expect(recallReplyIntent('Más adelante te digo, ahora estoy fuera')).toBeNull()
    expect(recallReplyIntent('Mañanas')).toBeNull()
    expect(recallReplyIntent('Sí, por favor')).toBeNull()
    expect(recallReplyIntent('')).toBeNull()
    expect(recallReplyIntent(null)).toBeNull()
  })

  it('parks the patient two months from the clinic\'s today, across a month end and a year end', () => {
    expect(RECALL_SNOOZE_DAYS).toBe(60)
    expect(snoozedUntil('2026-10-18')).toBe('2026-12-17')
    expect(snoozedUntil('2026-11-15')).toBe('2027-01-14')
    expect(snoozedUntil('2026-10-18', 1)).toBe('2026-10-19')
  })
})
