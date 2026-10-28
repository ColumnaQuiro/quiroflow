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
      // seedStaffAccount() grants the add-on, yet growth is false: Practice
      // includes Growth, so switching to it must drop the Growth line rather
      // than bill 39 EUR for what the plan already has. A switch to Solo
      // carries it across instead -- see growth-addon-purchase.cy.ts.
      cy.intercept('POST', '/api/billing/preview', {
        statusCode: 200,
        body: { previewable: true, amountDueCents: 4500, taxCents: 945, currency: 'eur' },
      }).as('preview')
      cy.intercept('POST', '/api/billing/subscribe', { statusCode: 200, body: { updated: true } }).as('subscribe')

      cy.get('.grid.lg\\:grid-cols-3').contains('.rounded-card', 'Practice').as('practiceCard')
      cy.get('@practiceCard').contains('button', 'Switch to Practice').click()
      cy.wait('@preview').its('request.body').should('deep.equal', { planId: 'pro', interval: 'monthly', extraProfessionals: 0, growth: false, receptionist: false })

      // Not committed yet -- the preview lands on the card, and nothing is
      // charged until the footer bar is confirmed.
      cy.get('@practiceCard').contains("You'd pay").should('be.visible')
      cy.get('@subscribe.all').should('have.length', 0)

      cy.contains('button', 'Confirm change').click()
      cy.wait('@subscribe').its('request.body').should('deep.equal', { planId: 'pro', interval: 'monthly', extraProfessionals: 0, growth: false, receptionist: false })
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
