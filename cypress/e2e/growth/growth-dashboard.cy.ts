// The Growth tier has two faces and the difference is the whole feature:
// an account without it sees the upgrade card over a blurred dashboard, one
// with it sees the dashboard itself. Both are driven here through the
// ?growth= preview flag that useGrowthTier() reads, which is also the only
// switch that exists until the tier gets a column of its own.
//
// scrollIntoView() before a visibility assertion is not optional padding:
// the page is taller than the scroller inside main, and main is
// overflow-hidden, so Cypress reports anything below the fold as hidden
// even though the scroller can reach it.

describe('Growth dashboard', () => {
  beforeEach(() => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
    })
  })

  it('shows the upgrade state to an account without the tier', () => {
    cy.visit('/growth?growth=0')

    cy.contains('The AI receptionist books patients while you are adjusting').should('be.visible')
    cy.contains('a', 'Start 14-day trial').should('have.attr', 'href', '/subscription')
    cy.contains('a', 'Talk to us').should('be.visible')

    // The plan delta has to be honest about what the clinic already pays for.
    cy.contains('What changes, and what does not').scrollIntoView().should('be.visible')
    cy.contains('td', 'Campaigns').scrollIntoView().should('be.visible')
    cy.contains('Already included in every plan').scrollIntoView().should('be.visible')

    // The dashboard behind the card is decoration, not content: it must not
    // be reachable by keyboard or read out as part of the page.
    cy.get('[data-test="growth-locked"] [inert]')
      .should('exist')
      .and('have.attr', 'aria-hidden', 'true')
  })

  it('shows the dashboard itself once the tier is on', () => {
    cy.visit('/growth?growth=1')

    cy.get('[data-test="growth-locked"]').should('not.exist')

    cy.contains('Acquisition funnel').should('be.visible')
    cy.contains('Converted to care plan').should('be.visible')
    cy.contains('23.3%').should('be.visible')

    cy.contains('AI receptionist').should('be.visible')
    cy.contains('148 conversations').should('be.visible')

    cy.contains('Needs attention').scrollIntoView().should('be.visible')
    cy.contains('WhatsApp number disconnected').scrollIntoView().should('be.visible')

    cy.contains('Channels').scrollIntoView().should('be.visible')
    cy.contains('td', 'Google Ads').scrollIntoView().should('be.visible')
    cy.contains('td', 'All channels').scrollIntoView().should('be.visible')
  })

  it('remembers the tier across navigation, so the flag is not needed on every link', () => {
    cy.visit('/growth?growth=1')
    cy.contains('Acquisition funnel').should('be.visible')

    cy.visit('/dashboard')
    cy.visit('/growth')
    cy.contains('Acquisition funnel').should('be.visible')
    cy.get('[data-test="growth-locked"]').should('not.exist')
  })

  it('is reachable from the sidebar, under a Growth group carrying the tier badge', () => {
    cy.visit('/dashboard')

    cy.get('nav').contains('GROWTH').should('be.visible')
    cy.get('nav').find('a[href="/growth"]').click()
    cy.location('pathname').should('eq', '/growth')
  })
})
