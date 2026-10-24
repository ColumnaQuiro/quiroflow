import { describe, expect, it } from 'vitest'
import { RECALL_SNOOZE_DAYS, declinesOnlyARecall, recallReplyIntent, snoozedUntil } from '../../utils/recallReply'

// What a reply to a recall means (the WhatsApp webhook applies it): a quick
// reply or a bare word that refuses, one that asks for later, or neither.

describe('a recall reply', () => {
  it('reads the templates\' own buttons, in either language', () => {
    expect(recallReplyIntent('No, gracias', true)).toBe('decline')
    expect(recallReplyIntent('No thanks', true)).toBe('decline')
    expect(recallReplyIntent('Más adelante', true)).toBe('snooze')
    expect(recallReplyIntent('Later on', true)).toBe('snooze')
  })

  it('reads BAJA and STOP typed by hand, whatever the case, spacing or punctuation', () => {
    expect(recallReplyIntent('BAJA', true)).toBe('decline')
    expect(recallReplyIntent('  stop ', true)).toBe('decline')
    expect(recallReplyIntent('Baja.', true)).toBe('decline')
    expect(recallReplyIntent('no gracias!', true)).toBe('decline')
    expect(recallReplyIntent('mas adelante', true)).toBe('snooze')
  })

  it('leaves a sentence to the desk, even one that starts the same way', () => {
    expect(recallReplyIntent('No gracias, mejor el jueves por la tarde', true)).toBeNull()
    expect(recallReplyIntent('Stop writing me on Mondays, Tuesdays are better', true)).toBeNull()
    expect(recallReplyIntent('Más adelante te digo, ahora estoy fuera', true)).toBeNull()
    expect(recallReplyIntent('Mañanas', true)).toBeNull()
    expect(recallReplyIntent('Sí, por favor', true)).toBeNull()
    expect(recallReplyIntent('', true)).toBeNull()
    expect(recallReplyIntent(null, true)).toBeNull()
  })

  it('reads "No, gracias" as a decline only when it answers a recall; BAJA and STOP always', () => {
    expect(recallReplyIntent('No, gracias', false)).toBeNull()
    expect(recallReplyIntent('No thanks', false)).toBeNull()
    expect(recallReplyIntent('BAJA', false)).toBe('decline')
    expect(recallReplyIntent('stop', false)).toBe('decline')
    expect(recallReplyIntent('Más adelante', false)).toBe('snooze')
    expect(declinesOnlyARecall('No, gracias')).toBe(true)
    expect(declinesOnlyARecall('Baja')).toBe(false)
    expect(declinesOnlyARecall('No gracias, mejor el jueves')).toBe(false)
  })

  it('parks the patient two months from the clinic\'s today, across a month end and a year end', () => {
    expect(RECALL_SNOOZE_DAYS).toBe(60)
    expect(snoozedUntil('2026-10-18')).toBe('2026-12-17')
    expect(snoozedUntil('2026-11-15')).toBe('2027-01-14')
    expect(snoozedUntil('2026-10-18', 1)).toBe('2026-10-19')
  })
})
