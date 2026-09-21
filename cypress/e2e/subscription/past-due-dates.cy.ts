// What a failed payment tells the clinic.
//
// Both halves matter. When Stripe can be read, the banner names the amount,
// the card, the bank's own reason and the retry date. When it cannot -- an
// outage, a rate limit, a key that is not configured in this environment --
// it must still say something true rather than inventing a retry or a
// cut-off date, because a clinic plans around those.
//
// The cut-off in particular is only ever Stripe's: nothing in this app locks
// a past_due account. trial-expiry-cron only locks TRIALING accounts that
// never had a Stripe subscription, so the date exists only when Stripe's
// dunning settings are configured to cancel.
describe('A failed payment names its dates, or says it cannot', () => {
  function seedPastDue() {
    return cy.seedStaffAccount().then((account) => {
      cy.task('db:setSubscriptionStripeIds', {
        accountId: account.accountId,
        stripeCustomerId: 'cus_test_stub',
        stripeSubscriptionId: 'sub_test_stub',
      })
      cy.setSubscriptionStatus(account.accountId, 'past_due')
      cy.login(account.email, account.password)
      return cy.wrap(account)
    })
  }

  it('names the amount, the reason and the retry date when Stripe answers', () => {
    seedPastDue().then(() => {
      cy.intercept('GET', '/api/billing/billing-info', {
        statusCode: 200,
        body: {
          hasCustomer: true,
          name: 'ColumnaQuiro',
          email: 'hola@quiroflow.com',
          country: 'ES',
          taxId: null,
          address: null,
          card: { brand: 'visa', last4: '4242', expMonth: 9, expYear: 2028 },
          nextPaymentDate: '2026-10-21T00:00:00.000Z',
          upcoming: null,
          pastDue: {
            amountCents: 16698,
            attemptedAt: '2026-09-21T04:02:00.000Z',
            nextAttemptAt: '2026-09-24T04:02:00.000Z',
            declineReason: 'Your card has insufficient funds.',
            invoiceUrl: 'https://invoice.stripe.com/i/test',
            cancelAt: '2026-10-05T00:00:00.000Z',
          },
        },
      }).as('billingInfo')

      cy.visit('/subscription')
      cy.wait('@billingInfo')

      cy.contains('Your last payment failed').should('be.visible')
      // The amount Stripe actually tried to take, not the plan's price.
      cy.contains('166,98').should('be.visible')
      cy.contains('21 de septiembre de 2026').should('be.visible')
      cy.contains('Your card has insufficient funds.').should('be.visible')
      cy.contains('We try again on 24 de septiembre de 2026').should('be.visible')
      cy.contains('access ends on 5 de octubre de 2026').should('be.visible')
      cy.contains('a', 'View the failed invoice').should('have.attr', 'href', 'https://invoice.stripe.com/i/test')

      // The reassurance is the most important sentence on the screen.
      cy.contains('calendar and your patient records stay safe').should('be.visible')
    })
  })

  it('promises no date it cannot know when Stripe cannot be read', () => {
    seedPastDue().then(() => {
      cy.intercept('GET', '/api/billing/billing-info', {
        statusCode: 200,
        body: { hasCustomer: false },
      }).as('billingInfo')

      cy.visit('/subscription')
      cy.wait('@billingInfo')

      cy.contains('Your last payment failed').should('be.visible')
      cy.contains('We will try the card again automatically.').should('be.visible')
      cy.contains('Access continues while we keep retrying.').should('be.visible')

      // No invented dates anywhere in the banner.
      cy.contains('Your last payment failed')
        .closest('div')
        .should('not.contain', 'access ends on')
        .and('not.contain', 'We try again on')
    })
  })
})
