describe('Role-based access control', () => {
  it('narrowing a role blocks the sidebar link and the route itself', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { patients_scope: 'none', settings_access: false },
      })

      const staffEmail = `frontdesk-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email: staffEmail,
        password: 'Test1234!',
        fullName: 'Fran Frontdesk',
      }).then(() => {
        cy.login(staffEmail, 'Test1234!')
        cy.visit('/dashboard')

        cy.contains('a', 'Calendar').should('be.visible')
        cy.contains('a', 'Patients').should('not.exist')
        cy.contains('a', 'Settings').should('not.exist')

        cy.visit('/patients')
        cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
        cy.location('search').should('eq', '?denied=1')
        cy.contains("You don't have access to that section.").should('be.visible')

        cy.visit('/settings')
        cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
        cy.location('search').should('eq', '?denied=1')
      })
    })
  })

  it('the owner role stays fully permissive and cannot be edited', () => {
    cy.seedStaffAccount().then((account) => {
      const ownerRole = account.roles.find((r) => r.name === 'Owner')!
      cy.login(account.email, account.password)
      cy.visit(`/settings/roles/${ownerRole.id}`)
      cy.contains("This is the account owner's role").should('be.visible')
      cy.contains('button', 'Save').should('not.exist')
    })
  })
})
