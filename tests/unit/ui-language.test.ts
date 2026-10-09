import { describe, it, expect } from 'vitest'
import { languageFromAcceptLanguage, languageOfTag } from '../../utils/uiLanguage'

// The server picks a first visit's language from Accept-Language; the client
// picks it from navigator.languages[0]. A browser builds the header from that
// same list, so for a page not to switch language as it hydrates, the header
// has to come out the way its first entry would.
describe('Interface language from the browser', () => {
  it('is Spanish for any Spanish tag, English for anything else', () => {
    for (const tag of ['es', 'es-ES', 'ES-es', 'es-419']) expect(languageOfTag(tag), tag).to.eq('es')
    for (const tag of ['en-GB', 'ca-ES', 'fr', 'pt-BR', '', undefined]) expect(languageOfTag(tag), String(tag)).to.eq('en')
  })

  it("reads a browser's header the way navigator.languages[0] reads", () => {
    // What Chrome sends for languages ['es-ES', 'es', 'en'].
    expect(languageFromAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).to.eq('es')
    expect(languageFromAcceptLanguage('en-GB,en;q=0.9,es;q=0.8')).to.eq('en')
    // Catalan first: the client says English for it, so the server must too.
    expect(languageFromAcceptLanguage('ca-ES,ca;q=0.9,es;q=0.8')).to.eq('en')
  })

  it('goes by q-value, not position, and earliest among equals', () => {
    expect(languageFromAcceptLanguage('en;q=0.5, es;q=0.9')).to.eq('es')
    expect(languageFromAcceptLanguage('es, en')).to.eq('es')
    expect(languageFromAcceptLanguage('en;q=0.8, es;q=0.8')).to.eq('en')
  })

  it('ignores refused and wildcard entries', () => {
    expect(languageFromAcceptLanguage('en;q=0, es;q=0.5')).to.eq('es')
    expect(languageFromAcceptLanguage('*, es;q=0.5')).to.eq('es')
  })

  it('is English with no usable header', () => {
    for (const header of [undefined, null, '', '*', ' , ']) expect(languageFromAcceptLanguage(header), String(header)).to.eq('en')
  })
})
