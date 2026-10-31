// A bad address (error.vue). Nuxt's own page was a bare English "404" with no
// way back; this one says what happened in the interface language and leads
// staff back in, while a patient's broken link sends them to their clinic.

describe('The error page', () => {
  it('tells staff the page does not exist, and takes them back in', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/no-such-screen', { failOnStatusCode: false })
      cy.get('[data-cy=error-page]').should('have.attr', 'data-status', '404')
      cy.contains('h1', "This page doesn't exist").should('be.visible')
      cy.title().should('equal', "This page doesn't exist · QuiroFlow")
      cy.get('[data-cy=error-try-again]').should('not.exist')
      cy.get('[data-cy=error-home]').click()
      cy.location('pathname').should('not.eq', '/no-such-screen')
      cy.get('[data-cy=error-page]').should('not.exist')
    })
  })

  it('speaks the interface language', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setStaffLanguage', { teamMemberId: account.teamMemberId, language: 'es' })
      cy.login(account.email, account.password)
      // Signing in applies the saved language on the way through the app.
      cy.visit('/dashboard')
      cy.visit('/no-such-screen', { failOnStatusCode: false })
      cy.contains('h1', 'Esta página no existe').should('be.visible')
      cy.get('html').should('have.attr', 'lang', 'es')
      cy.get('[data-cy=error-home]').should('contain.text', 'Ir a QuiroFlow')
    })
  })

  it("sends a patient with a broken link back to their clinic, not to the staff sign-in", () => {
    // Signed out, with English chosen on this browser (otherwise the
    // browser's own language decides, which is the machine's).
    cy.setCookie('quiroflow-lang', 'en')
    cy.visit('/book/no-such-clinic/extra', { failOnStatusCode: false, onBeforeLoad: (win) => win.localStorage.setItem('quiroflow-lang', 'en') })
    cy.get('[data-cy=error-page]').should('have.attr', 'data-status', '404')
    cy.contains('If your clinic sent it, ask them for a new one').should('be.visible')
    cy.get('[data-cy=error-home]').should('not.exist')
  })
})
