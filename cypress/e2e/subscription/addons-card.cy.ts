// The Add-ons card on the Subscription page: Growth and the AI receptionist
// added or removed there, without going through "Change plan".
//
// /api/billing/preview and /api/billing/subscribe are stubbed for the same
// reason as the other subscription specs -- they call Stripe, which CI does not
// have. What is under test is what the owner is shown and what reaches the
// request body, which is what decides what they are charged for.

function seedActiveSubscriber() {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:setSubscriptionStripeIds', { accountId: account.accountId, stripeCustomerId: 'cus_test_stub', stripeSubscriptionId: 'sub_test_stub' })
    // seedStaffAccount grants Growth, so every Growth spec does not 402.
    cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
    cy.setSubscriptionStatus(account.accountId, 'active')
    cy.login(account.email, account.password)
    return cy.wrap(account)
  })
}

describe('The Add-ons card', () => {
  it('adds the AI receptionist from the Subscription page, showing Stripe\'s charge first', () => {
    seedActiveSubscriber().then(() => {
      cy.intercept('POST', '/api/billing/preview', { statusCode: 200, body: { previewable: true, amountDueCents: 1530, taxCents: 266, currency: 'eur' } }).as('preview')
      cy.intercept('POST', '/api/billing/subscribe', { statusCode: 200, body: { updated: true } }).as('subscribe')
      cy.visit('/subscription')

      cy.get('[data-cy=subscription-addon-receptionist]', { timeout: 20000 }).scrollIntoView()
      cy.get('[data-cy=subscription-addon-receptionist-state]').should('have.text', 'Not added')
      cy.get('[data-cy=subscription-addon-receptionist]').should('contain', '19,00')
      cy.get('[data-cy=subscription-addon-receptionist-add]').click()

      cy.wait('@preview').its('request.body').should('deep.equal', { planId: 'starter', interval: 'monthly', extraProfessionals: 0, growth: false, receptionist: true })
      cy.get('[data-cy=subscription-addon-preview]').should('contain', '15,30')
      cy.get('[data-cy=subscription-addon-confirm]').click()
      cy.wait('@subscribe').its('request.body').should('deep.equal', { planId: 'starter', interval: 'monthly', extraProfessionals: 0, growth: false, receptionist: true })
    })
  })

  it('opens the same confirmation from the receptionist card\'s Add button', () => {
    seedActiveSubscriber().then(() => {
      cy.intercept('POST', '/api/billing/preview', { statusCode: 200, body: { previewable: true, amountDueCents: 0, taxCents: 0, currency: 'eur' } }).as('preview')
      cy.visit('/subscription')
      cy.get('[data-cy=subscription-receptionist-add]', { timeout: 20000 }).click()
      cy.get('[data-cy=subscription-addon-receptionist-confirm]').should('be.visible')
      cy.wait('@preview').its('request.body.receptionist').should('eq', true)
      // Not the Change plan panel.
      cy.contains('h2', 'Change plan').should('not.exist')
    })
  })

  it('never charges the receptionist on top of Growth', () => {
    seedActiveSubscriber().then((account) => {
      cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: true })
      cy.visit('/subscription')
      cy.get('[data-cy=subscription-addon-receptionist-state]', { timeout: 20000 }).should('have.text', 'Included in Growth')
      cy.get('[data-cy=subscription-addon-receptionist-add]').should('not.exist')
      cy.get('[data-cy=subscription-addon-growth-remove]').should('be.visible')
    })
  })

  it('has nothing to buy on a complimentary account', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setComped(account.accountId, true)
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.get('[data-cy=subscription-addon-growth-state]', { timeout: 20000 }).should('have.text', 'No charge')
      cy.get('[data-cy=subscription-addon-receptionist-state]').should('have.text', 'No charge')
      cy.get('[data-cy=subscription-addons]').should('not.contain', '€')
      cy.get('[data-cy=subscription-addon-growth-add], [data-cy=subscription-addon-receptionist-add]').should('not.exist')
    })
  })
})
