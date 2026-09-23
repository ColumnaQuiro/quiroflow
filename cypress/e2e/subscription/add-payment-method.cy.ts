// "Add payment method" has to reach Stripe.
//
// It did not. The button emitted into openPortal(), which asks
// /api/billing/portal-session for Stripe's Customer PORTAL -- and the portal
// only exists once the account has a Stripe customer. A trialing account has
// never had one, so the endpoint answered 400 every time, useBillingPortal
// caught it, and the browser was sent to `mailto:`. The clinic's mail client
// opened, unasked, in place of a card form: on every click, for every trial,
// with nothing logged and nothing on screen to say why.
//
// Collecting a FIRST card is Checkout's job (/api/billing/subscribe), which
// is also what creates the customer the portal needs later. These assert
// which endpoint each entry point asks for, because that is the whole bug --
// both buttons looked identical and one of them could never work.
describe('Adding a payment method', () => {
  // Stubbed, as in cancel-entry.cy.ts: the real endpoints call Stripe, which
  // is not configured in CI. What matters here is which one gets asked.
  const stubBoth = () => {
    cy.intercept('POST', '/api/billing/subscribe', { statusCode: 200, body: { url: '/subscription?checkout=stub' } }).as('checkout')
    cy.intercept('POST', '/api/billing/portal-session', { statusCode: 200, body: { url: '/subscription?portal=stub' } }).as('portal')
  }

  it('sends a trialing account to Checkout, not to the portal it has no customer for', () => {
    cy.seedStaffAccount().then((account) => {
      // A fresh account is trialing with no Stripe identity -- exactly the
      // state in which the old wiring could only ever open an email.
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      stubBoth()

      cy.contains('button', 'Add payment method').click()

      cy.wait('@checkout').its('request.body').should((body) => {
        // The plan they are already trialing, so there is nothing to ask
        // first -- and the seats and Growth flag come along, or the card
        // would be added against something other than what they have been
        // using.
        expect(body.planId, 'checkout is for the plan on the subscription').to.be.a('string').and.not.be.empty
        expect(body.interval).to.be.oneOf(['monthly', 'annual'])
      })
      cy.get('@portal.all').should('have.length', 0)
    })
  })

  it('sends an account that already has a Stripe customer to the portal', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setSubscriptionStripeIds', {
        accountId: account.accountId,
        stripeCustomerId: 'cus_test_stub',
        stripeSubscriptionId: 'sub_test_stub',
      })
      cy.setSubscriptionStatus(account.accountId, 'active')

      cy.login(account.email, account.password)
      cy.visit('/subscription')
      stubBoth()

      // Whatever this button reads -- "Manage payment method" with a card on
      // file, "Add payment method" without one -- an account WITH a customer
      // belongs in the portal, which is the right tool once it exists.
      cy.contains('button', /payment method/i).click()
      cy.wait('@portal')
      cy.get('@checkout.all').should('have.length', 0)
    })
  })

  // Checkout now carries the trial over: the card goes on file mid-trial and
  // the first charge lands when the trial ends, so the row stays 'trialing'
  // with a Stripe subscription behind it. Both banners used to go on asking
  // for the card regardless -- the amber one on every page with "Upgrade
  // now", and the trial card here with "Add a card before then".
  it('stops asking for a card once a trialing account has put one on file', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/subscription')

      // Before: a plain trial is asked, in both places.
      cy.contains('a', 'Upgrade now').should('be.visible')
      cy.get('[data-test="trial-banner"]').within(() => {
        cy.contains('button', 'Add payment method').should('be.visible')
      })

      cy.task('db:setSubscriptionStripeIds', {
        accountId: account.accountId,
        stripeCustomerId: 'cus_test_stub',
        stripeSubscriptionId: 'sub_test_stub',
      })
      cy.reload()

      cy.get('[data-test="trial-banner"]').within(() => {
        cy.contains('Your card is on file and nothing has been charged yet.').should('be.visible')
        cy.contains('The first payment is taken on').should('be.visible')
        cy.contains('button', 'Add payment method').should('not.exist')
      })
      cy.contains('a', 'Upgrade now').should('not.exist')
    })
  })

  // The other half. Even where the portal IS the right call, a failure used
  // to navigate the browser to a mailto: -- so a refusal, a misconfigured
  // deployment and a network blip all looked like "this button writes an
  // email", and nobody found out the portal was broken.
  it('says why the portal failed instead of silently opening an email', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setSubscriptionStripeIds', {
        accountId: account.accountId,
        stripeCustomerId: 'cus_test_stub',
        stripeSubscriptionId: 'sub_test_stub',
      })
      cy.setSubscriptionStatus(account.accountId, 'active')

      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.intercept('POST', '/api/billing/portal-session', {
        statusCode: 500,
        body: { statusMessage: 'Platform billing Stripe is not configured on this deployment' },
      }).as('portal')

      cy.contains('button', /payment method/i).click()
      cy.wait('@portal')

      // The reason Stripe gave, on screen -- and the page still where it was,
      // rather than replaced by whatever a mailto: hands to the OS.
      cy.contains('Platform billing Stripe is not configured on this deployment').should('be.visible')
      cy.location('pathname').should('eq', '/subscription')
    })
  })
})
