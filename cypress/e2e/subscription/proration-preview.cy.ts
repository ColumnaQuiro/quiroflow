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
      cy.contains('button', 'Change plan').click()
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

      cy.get('.grid.lg\\:grid-cols-3').contains('.rounded-card', 'Practice').as('practiceCard')
      cy.get('@practiceCard').contains('button', 'Switch to Practice').click()
      cy.wait('@preview').its('request.body').should('deep.equal', { planId: 'pro', interval: 'monthly', extraProfessionals: 0, growth: true })

      // Not committed yet -- the preview lands on the card, and nothing is
      // charged until the footer bar is confirmed.
      cy.get('@practiceCard').contains("You'd pay").should('be.visible')
      cy.get('@subscribe.all').should('have.length', 0)

      cy.contains('button', 'Confirm change').click()
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

      cy.get('.grid.lg\\:grid-cols-3').contains('.rounded-card', 'Practice').as('practiceCard')
      cy.get('@practiceCard').contains('button', 'Switch to Practice').click()
      cy.wait('@preview')

      // Backing out is leaving the screen, not dismissing the card: the
      // preview is information, and nothing commits until Confirm change.
      cy.contains('button', 'Back to subscription').click()
      cy.contains('button', 'Change plan').should('be.visible')
      cy.get('@subscribe.all').should('have.length', 0)
    })
  })
})
