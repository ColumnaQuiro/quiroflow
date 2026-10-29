// What a clinic reads before trusting QuiroFlow with its patients: the
// security page and the privacy policy, in the visitor's language, with no
// session. Both list the same subprocessors from utils/legalSubprocessors.ts.
//
// The privacy policy used to be an English draft full of "[confirm region]"
// placeholders; a bracket left in it is a promise nobody has checked, so the
// spec fails on one.

const browserIn = (tags: string[]) => ({
  headers: { 'Accept-Language': tags.join(',') },
  onBeforeLoad: (win: Window) => Object.defineProperty(win.navigator, 'languages', { value: tags }),
})
const inSpanish = browserIn(['es-ES', 'es'])
const inEnglish = browserIn(['en-GB', 'en'])

describe('Security and privacy pages', () => {
  it('describe security in Spanish for a Spanish browser, signed out', () => {
    cy.visit('/legal/security', inSpanish)
    cy.contains('h1', 'Seguridad y protección de datos').should('be.visible')
    cy.contains('h2', 'Dónde están tus datos').should('be.visible')
    cy.contains('Irlanda').should('be.visible')
    cy.get('[data-cy=subprocessors] li').should('have.length.at.least', 8)
    cy.get('[data-cy=subprocessors]').should('contain', 'Supabase').and('contain', 'Anthropic').and('contain', 'Cláusulas contractuales tipo')
    cy.contains('Where your data is').should('not.exist')
  })

  it('switch to English with the language toggle', () => {
    cy.visit('/legal/security', inSpanish)
    cy.contains('h1', 'Seguridad y protección de datos').should('be.visible')
    // The toggle marks the current language only once mounted, so this waits
    // out hydration: a click on the server-rendered button does nothing.
    cy.get('button[aria-label="Español"]').should('have.attr', 'aria-pressed', 'true')
    cy.get('button[aria-label="English"]').click()
    cy.contains('h1', 'Security & data protection').should('be.visible')
    cy.get('[data-cy=subprocessors]').should('contain', 'Standard Contractual Clauses')
  })

  it('give a privacy policy with every placeholder filled in, in both languages', () => {
    cy.visit('/legal/privacy', inEnglish)
    cy.contains('h1', 'Privacy policy').should('be.visible')
    cy.contains('Columnaquiro S.L., NIF B16365504').should('be.visible')
    cy.get('section').invoke('text').should('not.match', /\[[^\]]*\]/)
    cy.get('[data-cy=subprocessors] li').should('have.length.at.least', 8)

    cy.visit('/legal/privacy', inSpanish)
    cy.contains('h1', 'Política de privacidad').should('be.visible')
    cy.get('section').invoke('text').should('not.match', /\[[^\]]*\]/)
    cy.contains('a', 'Seguridad y protección de datos').click()
    cy.location('pathname').should('eq', '/legal/security')
  })
})
