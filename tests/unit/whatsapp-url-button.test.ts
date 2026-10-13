import { describe, expect, it } from 'vitest'
import { phoneForUrlButton } from '../../utils/whatsappUrlButton'

// The welcome drip's booking button is `.../oferta-primera-visita/{{1}}` with
// `?phone=` inside the blank; the digits alone built a page that does not exist.
describe('The phone in a URL button', () => {
  it('keeps what the example puts before the number', () => {
    expect(phoneForUrlButton('34620335584', 'https://columnaquiro.com/oferta-primera-visita/{{1}}', 'https://columnaquiro.com/oferta-primera-visita/?phone=3466767676'))
      .toBe('?phone=34620335584')
  })

  it('sends the digits alone when the blank is just the number', () => {
    expect(phoneForUrlButton('34620335584', 'https://example.com/book?phone={{1}}', 'https://example.com/book?phone=3466767676')).toBe('34620335584')
    expect(phoneForUrlButton('34620335584', 'https://example.com/book?phone={{1}}', 'https://example.com/book?phone=+3466767676')).toBe('34620335584')
  })

  it('falls back to the digits when the example does not say', () => {
    expect(phoneForUrlButton('34620335584', 'https://example.com/{{1}}', undefined)).toBe('34620335584')
    expect(phoneForUrlButton('34620335584', undefined, 'https://example.com/?phone=3466767676')).toBe('34620335584')
    expect(phoneForUrlButton('34620335584', 'https://example.com/{{1}}', 'https://other.com/?phone=3466767676')).toBe('34620335584')
    expect(phoneForUrlButton('34620335584', 'https://example.com/{{1}}', 'https://example.com/?ref=abc')).toBe('34620335584')
  })
})
