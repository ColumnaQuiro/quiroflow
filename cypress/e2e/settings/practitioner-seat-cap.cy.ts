describe('Practitioner seat cap', () => {
  it('blocks flipping a second staff member to practitioner on a full Solo plan and reverts the toggle', () => {
    cy.seedStaffAccount().then((account) => {
      // A fresh account is on Solo (included_professionals = 1) and the
      // owner created at signup is already a practitioner, so the seat is
      // already spoken for -- once Solo is paid for. An open free trial has
      // no cap (see the last test), so this one is a paying account.
      cy.setSubscriptionStatus(account.accountId, 'active')
      const staffEmail = `frontdesk-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email: staffEmail,
        password: 'Test1234!',
        fullName: 'Priya Practitioner',
      }).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/settings/team')

        cy.contains('tr', 'Priya Practitioner')
          .find('button[role="switch"]')
          .first()
          .as('practitionerToggle')
          .should('have.attr', 'aria-checked', 'false')
          .click()

        cy.contains('Your plan covers 1 practitioner(s) and all of them are in use.').should('be.visible')

        // The optimistic flip must be undone once the database rejects it --
        // otherwise the person looks schedulable when they aren't.
        cy.get('@practitionerToggle').should('have.attr', 'aria-checked', 'false')
      })
    })
  })

  it('allows the second seat once an extra professional is added to the plan', () => {
    cy.seedStaffAccount().then((account) => {
      // practitioner_seat_allowance() is included_professionals + extra_professionals
      // -- bypassing Stripe to set the latter directly exercises that addition
      // without needing live Stripe credentials in CI (the real path is the
      // platform-billing webhook reacting to a paid seat add-on).
      cy.setSubscriptionStatus(account.accountId, 'active')
      cy.setExtraProfessionals(account.accountId, 1)

      const staffEmail = `frontdesk-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email: staffEmail,
        password: 'Test1234!',
        fullName: 'Nour Newseat',
      }).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/settings/team')

        cy.contains('tr', 'Nour Newseat')
          .find('button[role="switch"]')
          .first()
          .as('practitionerToggle')
          .should('have.attr', 'aria-checked', 'false')
          .click()

        cy.get('@practitionerToggle').should('have.attr', 'aria-checked', 'true')
        cy.contains('Your plan covers 1 practitioner(s) and all of them are in use.').should('not.exist')
      })
    })
  })

  // Every trial starts on Solo with the owner in its one seat, so a cap here
  // refused every colleague invited as a practitioner: a clinic could not
  // try QuiroFlow as a team without paying first. The trial is the whole
  // product (20260924100032); the plan's cap starts when a plan is paid for,
  // and subscribe.post.ts refuses one that does not cover the team.
  it('has no seat cap during the free trial', () => {
    cy.seedStaffAccount().then((account) => {
      const staffEmail = `frontdesk-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email: staffEmail,
        password: 'Test1234!',
        fullName: 'Tomás Trialseat',
      }).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/settings/team')

        cy.contains('tr', 'Tomás Trialseat')
          .find('button[role="switch"]')
          .first()
          .as('practitionerToggle')
          .should('have.attr', 'aria-checked', 'false')
          .click()

        cy.get('@practitionerToggle').should('have.attr', 'aria-checked', 'true')
        cy.contains('all of them are in use').should('not.exist')

        cy.visit('/subscription')
        cy.contains('No seat limit during your free trial.').should('be.visible')
      })
    })
  })
})
