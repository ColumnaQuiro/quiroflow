// Someone invited to a clinic who signs up anywhere but through the invite
// link must still be offered the invite.
//
// The link keeps its token only in the localStorage of the browser that
// opened /join. Sign up in another browser -- the email app's own browser
// for the link, Safari for the confirmation -- and onboarding had no idea an
// invite existed. It asked them to create a practice; a colleague who did
// ended up owning an empty one, and the invite was refused from then on with
// "You already belong to a practice". Onboarding now looks the invite up by
// the confirmed email and offers it before the form.

describe('An invite reached without its link', () => {
  function setup() {
    const accountName = `Invite Clinic ${Date.now()}`
    return cy.seedStaffAccount({ accountName }).then((account) => {
      const email = `invitee-${Date.now()}@example.test`
      // Typed in capitals on Settings > Team; signed up in lower case.
      return cy
        .task('db:createInvite', { accountId: account.accountId, email: email.toUpperCase() })
        .then(() => cy.task('db:createLoneUser', { email, password: 'Test1234!' }))
        .then(() => ({ accountName, email }))
    })
  }

  it('is offered on onboarding, and joining lands in the inviting practice', () => {
    setup().then(({ accountName, email }) => {
      // Signed in with no token stored anywhere: this browser never saw the link.
      cy.login(email, 'Test1234!')
      cy.visit('/dashboard')

      cy.location('pathname').should('eq', '/onboarding')
      cy.get('[data-cy="onboarding-invite-offer"]').should('be.visible')
      cy.contains('h1', accountName).should('be.visible')
      cy.get('[data-cy="onboarding-join-invite"]').click()

      cy.location('pathname', { timeout: 20000 }).should('eq', '/dashboard')
      cy.window().its('localStorage').invoke('getItem', 'pending_invite_token').should('be.null')
    })
  })

  it('can be turned down for a practice of their own', () => {
    setup().then(({ email }) => {
      cy.login(email, 'Test1234!')
      cy.visit('/onboarding')

      cy.get('[data-cy="onboarding-decline-invite"]').click()
      cy.get('[data-cy="onboarding-invite-offer"]').should('not.exist')
      cy.get('#owner-name').should('be.visible')
    })
  })

  it('is not offered to someone with no invite', () => {
    const email = `nobody-${Date.now()}@example.test`
    cy.task('db:createLoneUser', { email, password: 'Test1234!' })
    cy.intercept('POST', '**/rest/v1/rpc/get_my_open_invite').as('lookup')
    cy.login(email, 'Test1234!')
    cy.visit('/onboarding')
    // The lookup has answered, so "not there" is not just "not yet".
    cy.wait('@lookup')
    cy.get('#owner-name').should('be.visible')
    cy.get('[data-cy="onboarding-invite-offer"]').should('not.exist')
  })
})
