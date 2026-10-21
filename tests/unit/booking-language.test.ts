import { describe, expect, it } from 'vitest'
import { bookingLanguageFromAcceptLanguage, bookingLanguageFromList, bookingLanguageOfTag, isBookingLanguage } from '../../utils/bookingLanguage'

// The public booking page's language, from ?lang=, the browser, or neither.
describe('the booking page language', () => {
  it('reads a tag by its primary language, and only the three it speaks', () => {
    expect(bookingLanguageOfTag('en-GB')).toBe('en')
    expect(bookingLanguageOfTag('FR')).toBe('fr')
    expect(bookingLanguageOfTag('es_ES')).toBe('es')
    expect(bookingLanguageOfTag('de')).toBeNull()
    expect(bookingLanguageOfTag('')).toBeNull()
    expect(isBookingLanguage('en')).toBe(true)
    expect(isBookingLanguage('pt')).toBe(false)
  })

  it('takes the first language the browser lists that the page speaks, else Spanish', () => {
    expect(bookingLanguageFromList(['fr-FR', 'fr', 'en'])).toBe('fr')
    expect(bookingLanguageFromList(['de-DE', 'en-GB'])).toBe('en')
    expect(bookingLanguageFromList(['de-DE', 'nl'])).toBe('es')
    expect(bookingLanguageFromList([])).toBe('es')
  })

  it('reads Accept-Language by quality, the way the CDN picks its copy', () => {
    expect(bookingLanguageFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en')
    expect(bookingLanguageFromAcceptLanguage('de-DE,de;q=0.9,fr;q=0.8,en;q=0.7')).toBe('fr')
    // Out of order is still by q.
    expect(bookingLanguageFromAcceptLanguage('en;q=0.5, fr;q=0.9')).toBe('fr')
    // Refused, unspoken or empty: Spanish.
    expect(bookingLanguageFromAcceptLanguage('en;q=0, de')).toBe('es')
    expect(bookingLanguageFromAcceptLanguage('*')).toBe('es')
    expect(bookingLanguageFromAcceptLanguage(undefined)).toBe('es')
  })
})
