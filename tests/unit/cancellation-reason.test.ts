import { describe, expect, it } from 'vitest'
import {
  CANCELLATION_REASON_BUTTON,
  CANCELLATION_REASON_CHOICES,
  CANCELLATION_REASONS,
  cancellationReasonFromRowId,
  cancellationReasonLabel,
  cancellationReasonRows,
  choiceLanguage,
  isCancellationReason,
} from '../../utils/cancellationReason'
import { reportStartDate, shareOf } from '../../utils/receptionistReport'
import { CANCEL_FIRST_BOOKING, CANCEL_FIRST_DRAFT } from '../../utils/receptionistTypes'

// The reasons the AI receptionist sends after cancelling a first visit, as a
// WhatsApp list (20261115172804). Meta refuses the whole message when a row
// title is over 24 characters or the button over 20 -- and refused, the
// patient gets nothing at all, so the limits are held here, not found out.
describe('Cancellation reasons as WhatsApp choices', () => {
  it('fits WhatsApp list limits in every language', () => {
    for (const language of ['es', 'en', 'fr'] as const) {
      const rows = cancellationReasonRows(language)
      expect(rows.length).toBeLessThanOrEqual(10)
      for (const row of rows) {
        expect(row.title.length, `${language}: ${row.title}`).toBeLessThanOrEqual(24)
        expect(row.id.length).toBeLessThanOrEqual(200)
      }
      expect(CANCELLATION_REASON_BUTTON[language].length).toBeLessThanOrEqual(20)
      expect(Object.keys(CANCELLATION_REASON_CHOICES[language]).sort()).toEqual([...CANCELLATION_REASONS].sort())
    }
  })

  it('reads a tapped row back as its reason, and nothing else as one', () => {
    for (const row of cancellationReasonRows('es')) {
      const reason = cancellationReasonFromRowId(row.id)
      expect(reason && isCancellationReason(reason)).toBe(true)
    }
    expect(cancellationReasonFromRowId('cancel_reason:later')).toBe('later')
    // A recall's or a reminder's button, or a made-up reason, is not ours.
    expect(cancellationReasonFromRowId('Más adelante')).toBeNull()
    expect(cancellationReasonFromRowId('cancel_reason:whatever')).toBeNull()
    expect(cancellationReasonFromRowId(undefined)).toBeNull()
  })

  it('writes to them in their language when the list has it, else Spanish', () => {
    expect(choiceLanguage('fr-FR')).toBe('fr')
    expect(choiceLanguage('en')).toBe('en')
    expect(choiceLanguage('de')).toBe('es')
    expect(choiceLanguage(null)).toBe('es')
  })

  it('names "not said" for cancellations from before reasons were asked', () => {
    const t = (_en: string, es: string) => es
    expect(cancellationReasonLabel(null, t)).toBe('Sin motivo')
    expect(cancellationReasonLabel('later', t)).toBe('Reservará más adelante')
  })
})

// 15 Nov 2026: of 14 first visits the receptionist cancelled, one person
// booked again. "Dime cuál te viene bien" was answered by nobody.
describe('Cancelling a first visit', () => {
  it('asks why instead of only offering another day, when it can send the reasons', () => {
    expect(CANCEL_FIRST_BOOKING).toContain('except a FIRST visit cancelled without a reason: then call ask_why_cancelled')
    expect(CANCEL_FIRST_BOOKING).toContain('call record_cancellation_reason')
    // A draft has no tools: a colleague does the cancelling, and nothing changes there.
    expect(CANCEL_FIRST_DRAFT).not.toContain('ask_why_cancelled')
  })

  it('treats naming the day they want instead as a move, not a cancellation', () => {
    // 13 Nov 2026: "el 19 no puedo... si tuvierais un hueco para el 26" was
    // cancelled first, the 26th could not be booked, and she had nothing.
    expect(CANCEL_FIRST_BOOKING).toContain('"el 19 no puedo, ¿tenéis hueco el 26?"')
  })
})

describe('The receptionist report period', () => {
  it('starts on a Monday, whole weeks back', () => {
    // Sunday 15 Nov 2026: this week began Monday the 9th.
    expect(reportStartDate('2026-11-15', 1)).toBe('2026-11-09')
    expect(reportStartDate('2026-11-15', 8)).toBe('2026-09-21')
    expect(reportStartDate('2026-11-09', 1)).toBe('2026-11-09')
    expect(reportStartDate('2026-11-09', 4)).toBe('2026-10-19')
  })

  it('gives a share only when there is something to divide', () => {
    expect(shareOf(41, 113)).toBe(36)
    expect(shareOf(0, 0)).toBeNull()
  })
})
