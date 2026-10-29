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

// The emailed link carries the token itself (#token_hash=…), and the page
// verifies it. The link it replaced came back from supabase.co with ?code=,
// which only the browser that asked for the reset could exchange -- opened on
// another device, in the Gmail app, or after asking from the mobile app, it
// said "invalid or has expired" on the first click. Visiting the page fresh,
// with nothing in storage, is exactly that other device.
describe('A password-reset link opened on a different device', () => {
  it('lets the person choose a new password, and works only once', () => {
    cy.seedStaffAccount().then((owner) => {
      cy.task<string>('db:recoveryTokenHash', { email: owner.email }).then((tokenHash) => {
        cy.visit(`/reset-password#token_hash=${tokenHash}&type=recovery`)

        // The spent token is gone from the address bar once it is verified.
        cy.location('hash').should('eq', '')
        cy.get('#password').type('NewPass123!')
        cy.get('#confirm').type('NewPass123!')
        cy.contains('button', 'Update password').click()
        cy.contains('Password updated.').should('be.visible')
        cy.task('db:passwordWorks', { email: owner.email, password: 'NewPass123!' }).should('eq', true)

        // The same link again, signed out: refused. Another page first, because
        // a visit that differs from the current URL only by its fragment is a
        // hash change, not a load -- the page would still be showing
        // "Password updated" and never look at the token again.
        cy.clearAllCookies()
        cy.clearAllLocalStorage()
        cy.visit('/forgot-password')
        cy.visit(`/reset-password#token_hash=${tokenHash}&type=recovery`)
        cy.contains('This link is invalid or has expired.').should('be.visible')
        cy.contains('a', 'Request a new one').should('have.attr', 'href', '/forgot-password')
      })
    })
  })
})
