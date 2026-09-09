describe('Platform billing: trial banner, subscription page, and lock screen', () => {
  it('shows the trial countdown banner and the subscription page for a fresh trialing account', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.contains(/days? left in your trial/).should('be.visible')

      cy.visit('/subscription')
      cy.contains('h1', 'Subscription').should('be.visible')
      cy.contains('Solo').should('be.visible')
      cy.contains('Free trial').should('be.visible')
      cy.contains(/day\(s\) left in your free trial/).should('be.visible')
    })
  })

  it('shows the urgent past_due banner instead of the trial countdown', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setSubscriptionStatus(account.accountId, 'past_due')
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.contains('Your last payment failed').should('be.visible')
      cy.contains('Update payment method').should('be.visible')
    })
  })

  it('blocks the whole staff app behind a full-screen lock once the account is locked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setSubscriptionStatus(account.accountId, 'locked')
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.contains('h1', 'Account locked').should('be.visible')
      // The owner gets an escape hatch to reactivate; the rest of the app
      // (sidebar, dashboard content) never renders at all.
      cy.contains('a', 'Choose a plan').should('be.visible')
      cy.get('aside').should('not.exist')
    })
  })

  it('lets a locked owner through to the subscription page to pay', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setSubscriptionStatus(account.accountId, 'locked')
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.contains('a', 'Choose a plan').click()
      // /subscription is the one page exempt from the lock -- without it a
      // trial that expired without ever subscribing has no way to pay us.
      cy.location('pathname').should('eq', '/subscription')
      cy.contains('h1', 'Subscription').should('be.visible')
      cy.contains('Account locked').should('not.exist')
      cy.contains('Solo').should('be.visible')
    })
  })
})
