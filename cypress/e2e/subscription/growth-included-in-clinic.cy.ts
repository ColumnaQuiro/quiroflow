// Clinic includes Growth in its price, and the two numbers that follow from it.
//
// The packaging exists to answer one competitor: QuiroHiro Plus is 97 EUR
// with unlimited users and an AI receptionist in the box. Selling Clinic at
// 149 EUR and then asking 39 EUR more for Growth loses that comparison on the
// shelf, whatever the feature list says underneath.
//
// Two things have to be true for "included" to mean anything, and they are
// what this spec pins: the screens have to open, and the bill must not add a
// line for it. The first is the entitlement path (requireGrowth reads the
// plan, not growth_addon); the second is the invoice.

interface SeededAccount {
  email: string
  password: string
  accountId: string
}

function onClinic(interval: 'monthly' | 'annual' = 'monthly') {
  return cy.seedStaffAccount().then((seeded) => {
    const account = seeded as SeededAccount
    // growth_addon false on purpose -- the plan is the only thing entitling
    // this account, which is exactly what is under test.
    cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
    cy.task('db:setSubscriptionPlan', { accountId: account.accountId, planId: 'clinic', interval })
    cy.setSubscriptionStatus(account.accountId, 'active')
    cy.login(account.email, account.password)
    return cy.wrap(account)
  })
}

describe('Growth included in the Clinic plan', () => {
  it('opens the Growth screens without the add-on ever being bought', () => {
    onClinic().then(() => {
      // No ?growth=1 here -- that preview flag would make this pass whatever
      // the server thought, which is the mistake worth avoiding.
      cy.visit('/growth/leads')
      cy.contains('Growth is part of the Growth tier.').should('not.exist')

      // And the API agrees, which is the half a rendered page cannot prove.
      cy.request({ url: '/api/growth/reputation', failOnStatusCode: false })
        .its('status')
        .should('eq', 200)
    })
  })

  it('adds nothing to the bill for something already in the price', () => {
    onClinic().then(() => {
      cy.visit('/subscription')

      // 149, not 188. A Clinic subscription has no Growth line item in
      // Stripe, so quoting one would overstate the invoice by 39 EUR/month.
      cy.contains('149,00').should('be.visible')
      cy.contains('188,00').should('not.exist')

      cy.contains('.rounded-card', 'Lead pipeline').as('growthCard')
      cy.get('@growthCard').scrollIntoView()
      cy.get('@growthCard').should('contain', 'Included')
      cy.get('@growthCard').should('contain', 'Clinic')
      // Offering to sell it would be the clearest possible way to say the
      // packaging is not real.
      cy.get('@growthCard').find('input[type="checkbox"]').should('not.exist')
    })
  })

  it('quotes an annual subscription its actual next charge, not a twelfth of it', () => {
    onClinic('annual').then((account) => {
      // The next-payment line only renders for a real Stripe subscription,
      // and billing-info calls Stripe, which CI has no keys for. Both are
      // stubbed so the arithmetic is what gets tested.
      cy.task('db:setSubscriptionStripeIds', {
        accountId: (account as SeededAccount).accountId,
        stripeCustomerId: 'cus_test_stub',
        stripeSubscriptionId: 'sub_test_stub',
      })
      cy.intercept('GET', '/api/billing/billing-info', {
        statusCode: 200,
        body: { hasCustomer: true, nextPaymentDate: '2027-09-17T00:00:00.000Z', card: null },
      }).as('billingInfo')

      cy.visit('/subscription')
      cy.wait('@billingInfo')

      // The plan card shows the monthly equivalent, 134 EUR.
      cy.contains('134,00').should('be.visible')
      // And the next charge is twelve of those. This used to be byte-identical
      // to the monthly figure despite a comment saying it was the full annual
      // amount, so an annual customer was told 134 EUR and billed 1.608.
      // Matched loosely on the thousands separator: Intl gives "1.608,00" in
      // a full ICU build and "1608,00" in the trimmed one Cypress ships, and
      // this test is about the arithmetic, not the grouping.
      cy.contains(/1\.?608,00/).should('be.visible')
    })
  })

  it('says prices exclude IVA, because Stripe adds 21% to every one of them', () => {
    onClinic().then(() => {
      cy.visit('/subscription')
      cy.contains('+ IVA').should('be.visible')
    })
  })
})
