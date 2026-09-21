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

        // The plan picker is its own screen now, reached from the summary's
        // primary button rather than sitting below it.
        cy.contains('button', 'Change plan').click()

        // Drop the extra seats back to 0 with the stepper, matching an owner
        // trying to shed the add-on cost -- with the owner plus the two
        // seeded practitioners, that's 3 active practitioners against Solo's
        // 1 included seat.
        // Re-queries each pass rather than holding the first element: the
        // button re-renders on every click, so a captured handle goes stale.
        const zeroTheSeats = () => {
          cy.get('button[aria-label="Remove a seat"]').then(($minus) => {
            if (!$minus.prop('disabled')) {
              cy.wrap($minus).click()
              zeroTheSeats()
            }
          })
        }
        zeroTheSeats()

        // Solo is already the current plan, so its own card offers "Stay on
        // Solo" and is disabled -- re-submitting the same plan with fewer
        // seats is what the footer bar is for.
        cy.get('.grid.lg\\:grid-cols-3').contains('.rounded-card', 'Solo').should('exist')
        cy.contains('button', 'Confirm change').click()

        cy.contains('This plan covers 1 practitioner(s), but 3 are currently active.').should('be.visible')
      })
    })
  })
})
