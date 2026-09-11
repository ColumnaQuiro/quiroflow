describe('Subscription cancellation entry point', () => {
  it('requests the Stripe cancel-flow deep link when "Cancel subscription" is clicked', () => {
    cy.seedStaffAccount().then((account) => {
      // A fresh account is trialing with no Stripe identity yet -- the
      // cancel link only makes sense once there's a real subscription to
      // cancel, so give it one directly (bypassing Stripe, same as every
      // other billing status test).
      cy.task('db:setSubscriptionStripeIds', {
        accountId: account.accountId,
        stripeCustomerId: 'cus_test_stub',
        stripeSubscriptionId: 'sub_test_stub',
      })
      cy.setSubscriptionStatus(account.accountId, 'active')

      cy.login(account.email, account.password)
      cy.visit('/subscription')

      // Stubbed -- the real endpoint calls Stripe, which isn't configured in
      // CI. This only verifies the client asks for the cancel flow, not that
      // Stripe's portal actually opens it (that's Stripe's own contract).
      cy.intercept('POST', '/api/billing/portal-session', { statusCode: 200, body: { url: '/subscription?portal=stub' } }).as('portalSession')

      cy.contains('button', 'Cancel subscription').click()
      cy.wait('@portalSession').its('request.body').should('deep.equal', { flow: 'cancel' })
    })
  })

  it('does not show a cancel link for a trial or comped account -- there is nothing real to cancel', () => {
    cy.seedStaffAccount().then((account) => {
      // A fresh account is trialing with no Stripe subscription at all --
      // the same "nothing to cancel" state a comped account is in, since
      // comped accounts never get real Stripe ids either.
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.contains('button', 'Cancel subscription').should('not.exist')
    })
  })
})
