describe('Platform billing: trial banner, subscription page, and read-only', () => {
  it('shows the trial countdown banner and the subscription page for a fresh trialing account', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.contains(/days? left in your trial/).should('be.visible')

      cy.visit('/subscription')
      cy.contains('h1', 'Subscription').should('be.visible')
      cy.contains('Solo').should('be.visible')
      cy.contains('Free trial').should('be.visible')
      cy.contains(/days? left in your free trial/).should('be.visible')
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

  it('keeps a locked account readable: the app opens, with a read-only bar instead of a lock screen', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setSubscriptionStatus(account.accountId, 'locked')
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=read-only-banner]').should('contain.text', 'Read-only account')
      // The app itself is there: no lock screen in its place.
      cy.contains('Account locked').should('not.exist')
      cy.get('aside').should('exist')
    })
  })

  it('shows a comped account the full plan design, read-only', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setComped(account.accountId, true)
      cy.login(account.email, account.password)
      cy.visit('/subscription')

      // The plan and what it covers still render...
      cy.contains('Complimentary').should('be.visible')
      cy.contains('What the plan covers').should('be.visible')
      cy.contains('Nothing is charged for this account').should('be.visible')

      // ...but a comped account is shown no money at all, rather than zeroes:
      // no price block, no Billing or Payments view, and no way to start
      // charging an account we agreed not to charge.
      cy.contains('Total per month').should('not.exist')
      cy.contains('Next payment').should('not.exist')
      cy.contains('[role="tab"]', 'Billing').should('not.exist')
      cy.contains('[role="tab"]', 'Payments').should('not.exist')
      cy.contains('button', 'Change plan').should('not.exist')

      // No seat ceiling is claimed for an account the trigger will not
      // enforce one against (practitioner_seat_allowance returns null when
      // comped).
      cy.contains('No seat limit on this account').should('be.visible')
      cy.contains('seats').should('not.contain', ' of ')
    })
  })

  it('shows the AI receptionist and its replies even on a comped account, with no charge', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setComped(account.accountId, true)
      cy.task('db:insertRows', {
        table: 'receptionist_replies',
        rows: [1, 2, 3].map((i) => ({ account_id: account.accountId, conversation_key: `test:${i}`, delivery: 'sent' })),
      })
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.get('[data-cy=subscription-receptionist]', { timeout: 20000 }).should('be.visible')
      cy.get('[data-cy=subscription-receptionist-state]').should('have.text', 'No charge')
      cy.get('[data-cy=subscription-receptionist-replies]').should('have.text', '3')
      cy.get('[data-cy=subscription-receptionist]').invoke('text').should('match', /of 1\.?000 replies included this month/)
      cy.get('[data-cy=subscription-receptionist-terms]').should('contain', 'pays nothing for it')
      // Still no money on a comped account's page.
      cy.get('[data-cy=subscription-receptionist]').should('not.contain', '€')
    })
  })

  it("says a trial has the AI receptionist on the trial's 200 replies", () => {
    cy.seedStaffAccount().then((account) => {
      // seedStaffAccount buys Growth; a trial as it starts has nothing.
      cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
      cy.task('db:seedReceptionistReplies', { accountId: account.accountId, count: 37 })
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.get('[data-cy=subscription-receptionist-state]', { timeout: 20000 }).should('have.text', 'In your trial')
      cy.get('[data-cy=subscription-receptionist-replies]').should('have.text', '37')
      cy.get('[data-cy=subscription-receptionist]').should('contain', 'of 200 replies in the free trial')
      cy.get('[data-cy=subscription-addon-receptionist-state]').should('have.text', 'In your trial')
      cy.get('[data-cy=subscription-addon-growth-state]').should('have.text', 'In your trial')
    })
  })

  it('says a trial that bought Growth has the AI receptionist, at no charge until it ends', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.get('[data-cy=subscription-receptionist-state]', { timeout: 20000 }).should('have.text', 'In your trial')
      cy.get('[data-cy=subscription-receptionist-replies]').should('have.text', '0')
    })
  })

  it('takes a read-only owner from the bar to the subscription page to pay', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setSubscriptionStatus(account.accountId, 'locked')
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      // Once a day the owner is asked as well; put away here.
      cy.get('[data-cy=confirm-dialog-cancel]').click()
      cy.get('[data-cy=read-only-banner]').contains('a', 'Add a card to reactivate').click()
      cy.location('pathname').should('eq', '/subscription')
      cy.contains('h1', 'Subscription').should('be.visible')
      cy.get('[data-cy=trial-ended-banner]').should('contain.text', 'Your account is read-only')
      cy.get('[data-cy=trial-ended-add-card]').should('be.visible')
      cy.contains('Solo').should('be.visible')
    })
  })
})
