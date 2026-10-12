// The owner's Monday summary can be switched off from the web's My Account
// (the app's Avisos writes the same staff_push_preferences column). Only for
// owners. What it sends is unit-tested (tests/unit/weekly-digest.test.ts).
describe('Weekly summary switch', () => {
  it('an owner turns it off and back on, and it is saved', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.intercept({ method: /POST|PATCH/, url: /\/rest\/v1\/staff_push_preferences/ }).as('save')
      cy.visit('/account')
      cy.get('[data-cy=account-weekly-digest-toggle]').should('have.attr', 'aria-checked', 'true').and('not.be.disabled').click()
      cy.wait('@save')
      cy.get('[data-cy=account-weekly-digest-toggle]').should('have.attr', 'aria-checked', 'false')
      cy.task<{ weekly_digest: boolean } | null>('db:staffPushPreferences', { teamMemberId: account.teamMemberId }).its('weekly_digest').should('eq', false)
      cy.reload()
      cy.get('[data-cy=account-weekly-digest-toggle]').should('have.attr', 'aria-checked', 'false').and('not.be.disabled').click()
      cy.wait('@save')
      cy.task<{ weekly_digest: boolean } | null>('db:staffPushPreferences', { teamMemberId: account.teamMemberId }).its('weekly_digest').should('eq', true)
    })
  })
})
