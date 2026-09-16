import { appStoreUrl, playStoreUrl } from '../../../utils/appLinks'

// Reception's copy of the two store links, and the guard that stops a
// half-configured one reaching a patient.
//
// Both assertions read utils/appLinks rather than a literal URL, so the day
// the App Store's numeric ID is filled in these tests change meaning with it
// instead of turning red on a correct change.

describe('Sharing the patient app', () => {
  it('gives staff a copyable Google Play link', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/app')

      cy.contains('Share the app').should('be.visible')
      cy.contains('code', playStoreUrl()).should('be.visible')

      // The preview underneath is the same component patients see, so a
      // broken link here is a broken link there.
      cy.get('a[href*="play.google.com"]')
        .should('have.attr', 'href', playStoreUrl())
        .and('have.attr', 'rel', 'noopener')
    })
  })

  it('shows the App Store link only once its numeric ID is set', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/app')
      cy.contains('Share the app').should('be.visible')

      if (appStoreUrl()) {
        cy.get('a[href*="apps.apple.com"]').should('have.attr', 'href', appStoreUrl())
      } else {
        // Nothing linking to Apple anywhere on the page: no button, no code
        // block, no half-formed `…/id` URL for someone to paste at a patient.
        cy.get('a[href*="apps.apple.com"]').should('not.exist')
        cy.contains('link not set up yet').should('be.visible')
      }
    })
  })

  it('does not render the section behind the settings load', () => {
    // The links are constants, so they must be on screen before the account
    // round trip finishes -- that is the whole reason the section sits
    // outside the loading gate.
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/app')
      // Both pages merged into /settings/app, so Appointments now sits
      // further down a scrolling column. The assertion here was never about
      // the fold -- it is that these render while the account round trip is
      // still in flight, which is why the section lives outside the loading
      // gate. Scrolling to it keeps that meaning and drops the layout
      // coupling that made this spec fail on a reorder.
      cy.contains('Share the app').should('be.visible')
      cy.contains('h2', 'Appointments').scrollIntoView().should('be.visible')
    })
  })

  it('still answers the old /settings/patient-app URL', () => {
    // That URL is in bookmarks and quite possibly in a message already sent
    // to a patient, so the merge left a redirect rather than a 404.
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/patient-app')

      cy.location('pathname').should('eq', '/settings/app')
      cy.contains('Share the app').should('be.visible')
    })
  })
})
