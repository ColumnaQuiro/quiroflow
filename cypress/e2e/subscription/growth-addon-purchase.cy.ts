// seedStaffAccount() grants the Growth add-on by default (see
// cypress/support/commands.ts -- otherwise every Growth spec would 402), so
// both states here are set explicitly rather than relying on that default.
// This spec is about the purchase path, and the account's starting state is
// the input to it.
function seedActiveSubscriber(withGrowth: boolean) {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:setSubscriptionStripeIds', {
      accountId: account.accountId,
      stripeCustomerId: 'cus_test_stub',
      stripeSubscriptionId: 'sub_test_stub',
    })
    cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: withGrowth })
    cy.setSubscriptionStatus(account.accountId, 'active')
    cy.login(account.email, account.password)
    cy.visit('/subscription')
      cy.contains('button', 'Change plan').click()
    return cy.wrap(account)
  })
}

describe('Buying the Growth add-on', () => {
  it('re-prices every plan card and sends growth: true with the plan change', () => {
    seedActiveSubscriber(false).then(() => {
      // Stubbed for the same reason as the proration spec: the real routes
      // call Stripe, which isn't configured in CI. What's under test here is
      // that the tick travels from the checkbox to the request body -- the
      // one thing that decides whether the customer is charged for it.
      cy.intercept('POST', '/api/billing/preview', {
        statusCode: 200,
        body: { previewable: true, amountDueCents: 3900, taxCents: 819, currency: 'eur' },
      }).as('preview')
      cy.intercept('POST', '/api/billing/subscribe', { statusCode: 200, body: { updated: true } }).as('subscribe')

      // Anchored on the row's own heading: '.rounded-card' containing the
      // text 'Growth add-on' also matches every plan card, whose feature list
      // names the add-on and its price.
      cy.contains('h3', 'Growth add-on').closest('.rounded-card').as('growthCard')
      cy.get('@growthCard').scrollIntoView()
      cy.get('@growthCard').contains('39,00').should('be.visible')
      cy.get('@growthCard').find('[role="switch"]').should('have.attr', 'aria-checked', 'false')

      // Solo is 49€/mo on its own; with Growth the owner has to be shown 88€,
      // not 49, or they are told one number and billed another. 88 is also
      // the number the pricing is built around -- QuiroHiro Plus, the nearest
      // competitor with an AI receptionist in it, is 97€.
      //
      // The plan card now carries the PLAN price alone and the footer bar
      // carries the configured total, so the combined figure is asserted
      // where it is actually rendered.
      cy.get('.grid.lg\\:grid-cols-3').contains('.rounded-card', 'Solo').as('soloCard')
      cy.get('@soloCard').should('contain', '49,00')
      cy.contains('button', 'Confirm change').closest('.rounded-card').as('footer')
      cy.get('@footer').should('contain', '49,00')

      cy.get('@growthCard').find('[role="switch"]').click()
      cy.get('@footer').should('contain', '88,00')

      cy.get('@soloCard').contains('button', /^Switch to |^Stay on /).should('exist')
      cy.contains('button', 'Confirm change').click()
      cy.wait('@subscribe').its('request.body').should('deep.equal', { planId: 'starter', interval: 'monthly', extraProfessionals: 0, growth: true })
    })
  })

  it('offers to drop Growth when the account already has it', () => {
    seedActiveSubscriber(true).then(() => {
      cy.intercept('POST', '/api/billing/preview', {
        statusCode: 200,
        body: { previewable: true, amountDueCents: 0, taxCents: 0, currency: 'eur' },
      }).as('preview')

      // Ticked on arrival, and the current plan reads as current -- nothing to
      // change until the owner actually touches something.
      // Anchored on the row's own heading: '.rounded-card' containing the
      // text 'Growth add-on' also matches every plan card, whose feature list
      // names the add-on and its price.
      cy.contains('h3', 'Growth add-on').closest('.rounded-card').as('growthCard')
      cy.get('@growthCard').find('[role="switch"]').should('have.attr', 'aria-checked', 'true')
      cy.get('.grid.lg\\:grid-cols-3').contains('.rounded-card', 'Solo').as('soloCard')
      cy.get('@soloCard').contains('button', /^Stay on /).should('be.disabled')

      cy.get('@growthCard').find('[role="switch"]').click()
      cy.get('@soloCard').contains('button', /^Stay on /).should('be.disabled')
      cy.wait('@preview').its('request.body').should('deep.equal', { planId: 'starter', interval: 'monthly', extraProfessionals: 0, growth: false })
    })
  })
})
