describe('Practitioner seat cap', () => {
  it('blocks flipping a second staff member to practitioner on a full Solo plan and keeps it unsaved', () => {
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
        cy.get('[data-cy=team-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
        cy.contains('[data-cy=team-member-row]', 'Priya Practitioner').click()
        cy.get('[data-cy=member-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')

        cy.get('[data-cy=member-practitioner]')
          .as('practitionerToggle')
          .should('have.attr', 'aria-checked', 'false')
          .click()
        cy.get('[data-cy=member-save]').click()

        cy.get('[data-cy=member-seat-refused]').should('contain', 'Your plan covers 1 practitioner(s) and all of them are in use.')

        // Refused by the database, so nothing was saved: the change stays
        // unsaved on screen, with the reason, rather than looking done.
        cy.get('[data-cy=member-save-bar]').should('be.visible')
        cy.reload()
        cy.get('[data-cy=member-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=member-practitioner]').should('have.attr', 'aria-checked', 'false')
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
        cy.get('[data-cy=team-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
        cy.contains('[data-cy=team-member-row]', 'Nour Newseat').click()
        cy.get('[data-cy=member-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')

        cy.get('[data-cy=member-practitioner]')
          .as('practitionerToggle')
          .should('have.attr', 'aria-checked', 'false')
          .click()
        cy.get('[data-cy=member-save]').click()

        cy.get('[data-cy=member-save-bar]').should('not.exist')
        cy.get('[data-cy=member-seat-refused]').should('not.exist')
        cy.reload()
        cy.get('[data-cy=member-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
        cy.get('@practitionerToggle').should('have.attr', 'aria-checked', 'true')
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
        cy.get('[data-cy=team-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
        cy.contains('[data-cy=team-member-row]', 'Tomás Trialseat').click()
        cy.get('[data-cy=member-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')

        cy.get('[data-cy=member-practitioner]')
          .as('practitionerToggle')
          .should('have.attr', 'aria-checked', 'false')
          .click()
        cy.get('[data-cy=member-save]').click()

        cy.get('[data-cy=member-save-bar]').should('not.exist')
        cy.get('[data-cy=member-seat-refused]').should('not.exist')
        cy.get('@practitionerToggle').should('have.attr', 'aria-checked', 'true')

        cy.visit('/subscription')
        cy.contains('No seat limit during your free trial.').should('be.visible')
      })
    })
  })
})
