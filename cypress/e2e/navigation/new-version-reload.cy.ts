// A tab open across a release (plugins/stale-build-reload.client.ts): it
// notices the new build when it comes back to the front, says so, and
// reloads on the next navigation -- never in place, under someone's hands.

const LATEST = '/_nuxt/builds/latest.json*'

function openDashboard() {
  cy.seedStaffAccount().then((account) => {
    cy.login(account.email, account.password)
    cy.visit('/dashboard')
    cy.get('[data-cy=sidebar]').should('have.attr', 'data-ready', 'true')
  })
  // Gone after a full page load, still there after a client-side navigation.
  cy.window().then((win) => ((win as any).__sameDocument = true))
}

function returnToTab() {
  cy.document().then((doc) => doc.dispatchEvent(new Event('visibilitychange')))
}

describe('A new release while the tab is open', () => {
  it('shows a banner and reloads on the next navigation, not before', () => {
    cy.intercept('GET', LATEST, { id: 'a-newer-build', timestamp: Date.now() }).as('latest')
    openDashboard()

    returnToTab()
    cy.wait('@latest')
    cy.get('[data-cy=new-version-banner]').should('be.visible').and('contain', 'new version')
    cy.window().its('__sameDocument').should('eq', true)

    cy.get('[data-cy=nav-item][data-to="/patients"]').first().click()
    cy.location('pathname').should('eq', '/patients')
    cy.window().its('__sameDocument').should('be.undefined')
  })

  it('stays quiet while the tab is on the live build', () => {
    openDashboard()
    cy.window().then((win) => {
      const buildId = (win as any).__NUXT__.config.app.buildId
      cy.intercept('GET', LATEST, { id: buildId, timestamp: Date.now() }).as('latest')
    })

    returnToTab()
    cy.wait('@latest')
    cy.get('[data-cy=nav-item][data-to="/patients"]').first().click()
    cy.location('pathname').should('eq', '/patients')
    cy.get('[data-cy=new-version-banner]').should('not.exist')
    cy.window().its('__sameDocument').should('eq', true)
  })
})
