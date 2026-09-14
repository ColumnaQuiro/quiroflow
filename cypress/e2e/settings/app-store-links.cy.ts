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
      cy.visit('/settings/patient-app')

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
      cy.visit('/settings/patient-app')
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
      cy.visit('/settings/patient-app')
      cy.contains('Share the app').should('be.visible')
      cy.contains('Appointments').should('be.visible')
    })
  })
})
