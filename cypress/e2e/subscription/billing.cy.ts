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

  it('shows a comped account the full plan design, read-only', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setComped(account.accountId, true)
      cy.login(account.email, account.password)
      cy.visit('/subscription')

      // Everything a paying clinic sees renders...
      cy.contains('Comped -- no charge').should('be.visible')
      cy.contains('Included usage').should('be.visible')
      cy.contains('h2', 'Plans').should('be.visible')
      cy.contains('Solo').should('be.visible')
      cy.contains('Practice').should('be.visible')
      cy.contains('Clinic').should('be.visible')
      cy.contains('button', 'Your plan').should('be.disabled')

      // ...but there is no way to start charging an account we agreed not to
      // charge, and no seat ceiling is claimed that the trigger would not
      // enforce (practitioner_seat_allowance returns null when comped).
      cy.contains('button', 'Subscribe').should('not.exist')
      cy.contains('button', 'Switch to this plan').should('not.exist')
      cy.contains('h2', 'Change plan').should('not.exist')
      // The wording changed when Clinic went unlimited ("1 practitioner(s) --
      // unlimited included" read like a broken template); what matters is
      // unchanged -- no seat ceiling is claimed for an account the trigger
      // will not enforce one against.
      cy.contains('no seat limit on this plan').should('be.visible')
      cy.contains('seat(s) in use').should('not.exist')
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
