function seedActiveSubscriber() {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:setSubscriptionStripeIds', {
      accountId: account.accountId,
      stripeCustomerId: 'cus_test_stub',
      stripeSubscriptionId: 'sub_test_stub',
    })
    cy.setSubscriptionStatus(account.accountId, 'active')
    cy.login(account.email, account.password)
    cy.visit('/subscription')
    return cy.wrap(account)
  })
}

describe('Subscription proration preview', () => {
  it('previews the prorated charge before switching plans, then confirms it', () => {
    seedActiveSubscriber().then(() => {
      // Stubbed -- the real endpoints call Stripe, which isn't configured in
      // CI. This verifies the client shows the preview and, once confirmed,
      // sends the same body to /api/billing/subscribe that produced it.
      //
      // growth: true because seedStaffAccount() grants the add-on -- a plan
      // switch has to carry it across, or changing plan would silently cancel
      // Growth. See cypress/e2e/subscription/growth-addon-purchase.cy.ts.
      cy.intercept('POST', '/api/billing/preview', {
        statusCode: 200,
        body: { previewable: true, amountDueCents: 4500, taxCents: 945, currency: 'eur' },
      }).as('preview')
      cy.intercept('POST', '/api/billing/subscribe', { statusCode: 200, body: { updated: true } }).as('subscribe')

      cy.get('.grid.sm\\:grid-cols-3').contains('.rounded-card', 'Practice').as('practiceCard')
      cy.get('@practiceCard').contains('button', 'Switch to this plan').click()
      cy.wait('@preview').its('request.body').should('deep.equal', { planId: 'pro', interval: 'monthly', extraProfessionals: 0, growth: true })

      // Not committed yet -- no subscribe call until the owner confirms.
      cy.get('@practiceCard').contains("You'll be charged").should('be.visible')
      cy.get('@practiceCard').contains('button', 'Switch to this plan').should('not.exist')

      cy.get('@practiceCard').contains('button', 'Confirm switch').click()
      cy.wait('@subscribe').its('request.body').should('deep.equal', { planId: 'pro', interval: 'monthly', extraProfessionals: 0, growth: true })
    })
  })

  it('lets the owner back out of a preview without switching', () => {
    seedActiveSubscriber().then(() => {
      cy.intercept('POST', '/api/billing/preview', {
        statusCode: 200,
        body: { previewable: true, amountDueCents: 4500, taxCents: 945, currency: 'eur' },
      }).as('preview')
      cy.intercept('POST', '/api/billing/subscribe').as('subscribe')

      cy.get('.grid.sm\\:grid-cols-3').contains('.rounded-card', 'Practice').as('practiceCard')
      cy.get('@practiceCard').contains('button', 'Switch to this plan').click()
      cy.wait('@preview')

      cy.get('@practiceCard').contains('button', 'Cancel').click()
      cy.get('@practiceCard').contains('button', 'Switch to this plan').should('be.visible')
      cy.get('@subscribe.all').should('have.length', 0)
    })
  })
})
