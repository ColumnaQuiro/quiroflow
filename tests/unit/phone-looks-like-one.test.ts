import { describe, it, expect } from 'vitest'
import { looksLikePhoneNumber } from '../../utils/phone'

// A patient booked online on 24 Sep 2026 having picked +34 from the dropdown
// and typed "6" into the number field. `required` and type="tel" both
// accepted it, the RPC stored it, and the clinic had a confirmed appointment
// with no way to reach the person who made it.
//
// Pinned here rather than only through the form, because the same three rules
// are restated in SQL inside create_public_booking and the pair has to agree.
describe('Whether a typed number looks like a phone number at all', () => {
  describe('Spain, where an exact length is knowable', () => {
    it('takes a nine-digit mobile, however it is spaced', () => {
      expect(looksLikePhoneNumber('600123456', 'ES')).toBe(true)
      expect(looksLikePhoneNumber('600 123 456', 'ES')).toBe(true)
      expect(looksLikePhoneNumber(' 600-123-456 ', 'ES')).toBe(true)
    })

    it('takes the same number written with its own dial prefix', () => {
      expect(looksLikePhoneNumber('+34600123456', 'ES')).toBe(true)
      expect(looksLikePhoneNumber('+34 600 123 456', 'ES')).toBe(true)
    })

    it('takes a landline, because a reachable patient beats a tidy field', () => {
      // The label says "móvil". Someone who only has a landline still wants
      // the appointment, and refusing it loses a booking to make a point.
      expect(looksLikePhoneNumber('913456789', 'ES')).toBe(true)
    })

    it('refuses the booking that prompted this', () => {
      expect(looksLikePhoneNumber('6', 'ES')).toBe(false)
    })

    it('refuses a prefix with nothing behind it', () => {
      expect(looksLikePhoneNumber('+34', 'ES')).toBe(false)
      expect(looksLikePhoneNumber('+34 6', 'ES')).toBe(false)
    })

    it('refuses anything that is not nine digits', () => {
      expect(looksLikePhoneNumber('', 'ES')).toBe(false)
      expect(looksLikePhoneNumber('12345', 'ES')).toBe(false)
      expect(looksLikePhoneNumber('60012345', 'ES')).toBe(false)
      expect(looksLikePhoneNumber('6001234567', 'ES')).toBe(false)
    })

    it('refuses a field filled with something that is not a number', () => {
      expect(looksLikePhoneNumber('no tengo', 'ES')).toBe(false)
      expect(looksLikePhoneNumber('-', 'ES')).toBe(false)
    })
  })

  describe('everywhere else, where a floor is the honest rule', () => {
    it('takes the shorter national numbers that are real', () => {
      // Eight digits is a whole Norwegian number, and two of this clinic's
      // patients have one. A blanket nine-digit rule would refuse them.
      expect(looksLikePhoneNumber('40612345', 'NO')).toBe(true)
      expect(looksLikePhoneNumber('60123456', 'RS')).toBe(true)
    })

    it('still refuses a number too short to be one', () => {
      expect(looksLikePhoneNumber('6', 'NO')).toBe(false)
      expect(looksLikePhoneNumber('12345', 'FR')).toBe(false)
    })

    it('refuses more digits than E.164 allows', () => {
      expect(looksLikePhoneNumber('1234567890123456', 'FR')).toBe(false)
    })
  })

  it('judges a pasted foreign number by ITS country, not the dropdown', () => {
    // Leaving the selector on Spain and pasting a British number is a normal
    // thing to do, and Spain's nine digits would refuse a real one.
    expect(looksLikePhoneNumber('+447700900123', 'ES')).toBe(true)
    // The same allowance cannot rescue a number that is short in any country.
    expect(looksLikePhoneNumber('+4477', 'ES')).toBe(false)
  })
})
