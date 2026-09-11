// The portal's password-reset path used to dead-end: /portal/login linked to
// nothing, and the reset pages it should have reached hand you the STAFF
// sign-in and drop you on the staff dashboard afterwards -- neither of which a
// patient can use. This walks the chain a patient actually follows.
//
// No sign-in needed: every step here is unauthenticated navigation, which is
// exactly the part that was broken.
describe('A patient resetting their portal password', () => {
  it('can reach the reset page from the portal, and is kept on the patient side', () => {
    cy.visit('/portal/login')

    cy.contains('a', 'Forgot your password?')
      .should('have.attr', 'href', '/forgot-password?portal=1')
      .click()

    // Back-links must return to the portal sign-in, not /login.
    cy.location('pathname').should('eq', '/forgot-password')
    cy.contains('a', 'Back to sign in').should('have.attr', 'href', '/portal/login')

    // And the expired-link recovery keeps the portal hint too, so a patient
    // whose link timed out doesn't get bounced to the staff side either.
    cy.visit('/reset-password?portal=1')
    cy.contains('a', 'Request a new one').should('have.attr', 'href', '/forgot-password?portal=1')
  })

  it('leaves the staff reset flow pointing at the staff sign-in', () => {
    cy.visit('/forgot-password')
    cy.contains('a', 'Back to sign in').should('have.attr', 'href', '/login')

    cy.visit('/reset-password')
    cy.contains('a', 'Request a new one').should('have.attr', 'href', '/forgot-password')
  })
})
