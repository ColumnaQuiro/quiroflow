import { describe, it, expect } from 'vitest'
import { toE164, whatsappDigits } from '../../utils/phone'

// POST /api/public/v1/whatsapp/send compared "to" as given against toE164()
// of every patient number. toE164() returns digits only; "to" is documented
// as E.164, which is written with a "+". So a number addressed the documented
// way matched nobody, and the under-age and do-not-contact refusals never ran.
describe('A WhatsApp number as the public API is given it', () => {
  it('comes out in the shape toE164() gives a stored patient number', () => {
    expect(whatsappDigits('+34612345678')).toBe(toE164('612345678', 'ES'))
    expect(whatsappDigits('+34 612 34 56 78')).toBe(toE164('612 34 56 78', 'ES'))
  })

  it('reads "00" as the "+" it stands for', () => {
    expect(whatsappDigits('0034612345678')).toBe('34612345678')
  })

  it('leaves digits Meta would send as they are', () => {
    expect(whatsappDigits('34612345678')).toBe('34612345678')
    expect(whatsappDigits(' 34-612-345-678 ')).toBe('34612345678')
  })

  it('adds no country to a number that has none', () => {
    // Guessing Spain here would message whoever owns that number in Spain.
    expect(whatsappDigits('612345678')).toBe('612345678')
  })

  it('is empty for something that is not a number at all', () => {
    expect(whatsappDigits('call me')).toBe('')
  })
})
