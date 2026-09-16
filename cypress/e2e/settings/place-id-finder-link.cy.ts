// The Place ID field told staff to "find it with Google's Place ID Finder"
// and then left them to it. The ID appears nowhere in a Google Business
// Profile, and searching the phrase lands on Maps API documentation rather
// than on the tool, so the instruction had no next step in practice.
//
// Worth a test rather than a look, because the failure is silent: the field
// keeps working, the sentence still reads correctly, and nothing shows that
// the one part of it that mattered has stopped being clickable.
describe('Google Place ID', () => {
  it('links out to the Place ID Finder', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/communications-general')

      cy.get('[data-test="google-place-id"]').scrollIntoView().should('exist')
      cy.get('[data-test="place-id-finder-link"]')
        .should('have.attr', 'href', 'https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder')
        // A new tab, because leaving the page mid-edit would lose whatever
        // else has been typed into this form.
        .and('have.attr', 'target', '_blank')
        .and('have.attr', 'rel', 'noopener noreferrer')
    })
  })
})
