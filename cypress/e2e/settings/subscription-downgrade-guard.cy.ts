describe('Subscription downgrade seat guard', () => {
  it('blocks switching to a plan that would leave active practitioners over the new allowance', () => {
    cy.seedStaffAccount().then((account) => {
      // Raise the current allowance to 3 (1 included + 2 extra) so two more
      // practitioners can be seeded without enforce_practitioner_seats itself
      // rejecting the setup.
      cy.setExtraProfessionals(account.accountId, 2)

      const seedPractitioner = (fullName: string, email: string) =>
        cy.task('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          roleName: 'Front Desk',
          email,
          password: 'Test1234!',
          fullName,
          isPractitioner: true,
        })

      seedPractitioner('Dana Downgrade', `dana-${Date.now()}@example.test`)
      seedPractitioner('Eli Extraseat', `eli-${Date.now()}@example.test`).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/subscription')

        // Drop the extra-professionals add-on back to 0, matching an owner
        // trying to shed the add-on cost -- with the owner plus the two
        // seeded practitioners, that's 3 active practitioners against Solo's
        // 1 included seat.
        cy.contains('label', 'Extra professionals').find('input').clear().type('0')

        // Scoped to the plan-picker grid specifically -- the summary card
        // above it also renders the plan name "Solo" as plain text.
        cy.get('.grid.sm\\:grid-cols-3').contains('.rounded-card', 'Solo').within(() => {
          cy.contains('button', /Subscribe|Switch to this plan/).click()
        })

        cy.contains('This plan covers 1 practitioner(s), but 3 are currently active.').should('be.visible')
      })
    })
  })
})
