import { describe, expect, it } from 'vitest'
import { templateDateParts } from '../../utils/templateDate'

// The date and time a WhatsApp template's slots carry. 16:30 UTC on 9 Oct
// 2026 is 18:30 in Madrid (CEST).
const STARTS_AT = '2026-10-09T16:30:00Z'
const MADRID = 'Europe/Madrid'

describe('a template date', () => {
  it('is written in the language of the variant being sent', () => {
    expect(templateDateParts(STARTS_AT, 'es', MADRID)).toEqual({ date: '9 de octubre de 2026', time: '18:30' })
    expect(templateDateParts(STARTS_AT, 'en', MADRID)).toEqual({ date: '9 October 2026', time: '18:30' })
    expect(templateDateParts(STARTS_AT, 'fr', MADRID)).toEqual({ date: '9 octobre 2026', time: '18:30' })
  })

  it('takes Meta\'s underscored codes, and stays on a 24-hour clock', () => {
    expect(templateDateParts(STARTS_AT, 'en_US', MADRID)).toEqual({ date: 'October 9, 2026', time: '18:30' })
    expect(templateDateParts(STARTS_AT, 'es_ES', MADRID).date).toBe('9 de octubre de 2026')
  })

  it('falls back to Spanish for a code Intl cannot read', () => {
    expect(templateDateParts(STARTS_AT, 'not a language', MADRID)).toEqual({ date: '9 de octubre de 2026', time: '18:30' })
  })
})
