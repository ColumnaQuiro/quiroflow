// A free trial's plan follows the team (20261127064737_trial_plan_follows_the_team.sql).
//
// Every trial used to start on Solo and stay there. A clinic that invited its
// colleagues on day one reached the end of the trial with "Add card" offering
// Solo, which subscribe.post.ts then refused for covering one practitioner.
// Now two or more practitioners -- invites included -- put the trial on
// Practice, one puts it back on Solo, and a plan somebody chose by hand is
// never moved again.
type SubRow = { plan_id: string; extra_professionals: number; plan_chosen_at: string | null }
const subOf = (accountId: string) =>
  cy
    .task<SubRow[]>('db:selectRows', { table: 'subscriptions', columns: 'plan_id, extra_professionals, plan_chosen_at', match: { account_id: accountId } })
    .its(0)

describe('A trial plan that follows the team', () => {
  function openSubscription() {
    cy.visit('/subscription')
    cy.get('[data-cy=plan-name]', { timeout: 20000 }).should('be.visible')
  }

  it('moves to Practice when a practitioner is invited, checks out on it, and back to Solo when the invite goes', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)

      // The owner alone: Solo, and the card says why it may change.
      openSubscription()
      cy.get('[data-cy=plan-name]').should('have.text', 'Solo')
      cy.get('[data-cy=plan-follows-team]').should('contain', 'the plan follows your team')

      // Inviting a colleague who will see patients is enough: nobody has to
      // have accepted yet.
      cy.intercept('POST', '/api/invites/send', { statusCode: 200, body: { sent: true } }).as('sendInvite')
      cy.visit('/settings/team')
      cy.get('[data-cy=team-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=team-invite]').click()
      const email = `colleague-${Date.now()}@example.test`
      cy.get('[data-cy=invite-email]').type(email).should('have.value', email)
      cy.get('[data-cy=invite-name]').type('Clara Colega')
      cy.get('[data-cy=invite-practitioner]').should('be.checked')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=invite-result]').should('exist')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('[data-cy=team-invite-row]', email, { timeout: 20000 }).should('exist')

      subOf(account.accountId).should((row) => {
        expect(row.plan_id).to.eq('pro')
        expect(row.plan_chosen_at, 'the rule moved it, nobody chose it').to.be.null
      })

      openSubscription()
      cy.get('[data-cy=plan-name]').should('have.text', 'Practice')
      cy.get('[data-cy=plan-follows-team]').should('be.visible')

      // The card the owner adds is for Practice, not for the Solo the trial
      // started on. Stubbed: Stripe is not configured in CI.
      cy.intercept('POST', '/api/billing/subscribe', { statusCode: 200, body: { url: '/subscription?checkout=stub' } }).as('checkout')
      cy.contains('button', 'Add payment method').click()
      cy.wait('@checkout').its('request.body.planId').should('eq', 'pro')

      // Withdrawing the invite leaves one practitioner again: back to Solo.
      cy.visit('/settings/team')
      cy.get('[data-cy=team-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
      cy.contains('[data-cy=team-invite-row]', email).within(() => {
        cy.get('[data-cy=team-invite-revoke]').click()
      })
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=team-invites]').should('not.exist')

      subOf(account.accountId).its('plan_id').should('eq', 'starter')
      openSubscription()
      cy.get('[data-cy=plan-name]').should('have.text', 'Solo')
    })
  })

  it('does not count a front-desk invite, and adds the seats Practice does not include', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createInvite', { accountId: account.accountId, email: `desk-${Date.now()}@example.test`, roleName: 'Front Desk' })
      subOf(account.accountId).its('plan_id').should('eq', 'starter')

      // Owner + five invited practitioners: Practice covers four, so two seats
      // go on top, and the card added at the end of the trial covers everyone.
      for (let i = 0; i < 5; i++) {
        cy.task('db:createInvite', { accountId: account.accountId, email: `p${i}-${Date.now()}@example.test` })
      }
      subOf(account.accountId).should((row) => {
        expect(row.plan_id).to.eq('pro')
        expect(row.extra_professionals).to.eq(2)
      })
    })
  })

  it('keeps a plan chosen by hand, whatever the team does after', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createInvite', { accountId: account.accountId, email: `first-${Date.now()}@example.test` })
      subOf(account.accountId).its('plan_id').should('eq', 'pro')

      // Anyone setting the plan -- the webhook, the admin panel, by hand --
      // is a choice, and is recorded as one.
      cy.task('db:setSubscriptionPlan', { accountId: account.accountId, planId: 'starter' })
      subOf(account.accountId).its('plan_chosen_at').should('not.be.null')

      cy.task('db:createInvite', { accountId: account.accountId, email: `second-${Date.now()}@example.test` })
      subOf(account.accountId).its('plan_id').should('eq', 'starter')

      cy.login(account.email, account.password)
      openSubscription()
      cy.get('[data-cy=plan-name]').should('have.text', 'Solo')
      cy.get('[data-cy=plan-follows-team]').should('not.exist')
    })
  })

  it('leaves a trial with a card on file to Stripe', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setSubscriptionStripeIds', { accountId: account.accountId, stripeCustomerId: 'cus_test_stub', stripeSubscriptionId: 'sub_test_stub' })
      cy.task('db:createInvite', { accountId: account.accountId, email: `carded-${Date.now()}@example.test` })
      subOf(account.accountId).its('plan_id').should('eq', 'starter')
    })
  })

  it('never moves a Blind Spot account, and sizes the trial once it moves to the whole product', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateRows', { table: 'subscriptions', values: { plan_id: 'blind_spot' }, match: { account_id: account.accountId } })
      cy.task('db:updateRows', { table: 'accounts', values: { product: 'blind_spot' }, match: { id: account.accountId } })
      cy.task('db:createInvite', { accountId: account.accountId, email: `bs-${Date.now()}@example.test` })
      subOf(account.accountId).should((row) => {
        expect(row.plan_id).to.eq('blind_spot')
        expect(row.plan_chosen_at, 'moving onto Blind Spot is the product switch, not a choice of plan').to.be.null
      })

      // What /api/blind-spot/product does to move to the whole product: the
      // trial back to Solo, then the product. With two practitioners on the
      // team, the rule then puts it on Practice.
      cy.task('db:updateRows', { table: 'subscriptions', values: { plan_id: 'starter' }, match: { account_id: account.accountId } })
      cy.task('db:updateRows', { table: 'accounts', values: { product: 'clinic' }, match: { id: account.accountId } })
      subOf(account.accountId).its('plan_id').should('eq', 'pro')
    })
  })
})
