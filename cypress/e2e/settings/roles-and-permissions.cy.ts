import type { StaffAccount } from '../../support/commands'

// Settings > Roles and permissions: the list, the editor, the compare page,
// and the three ways the old page let a role go wrong -- saved with no name,
// saved twice under one name, or deleted from under the people holding it.

type Role = { roleId: string; isSystem: boolean; permissions: Record<string, unknown> }

function openRoles(account: StaffAccount) {
  cy.login(account.email, account.password)
  cy.visit('/settings/roles')
  cy.get('[data-cy=roles-page]').should('have.attr', 'data-ready', 'true')
}

function openRole(roleId: string) {
  cy.visit(`/settings/roles/${roleId}`)
  cy.get('[data-cy=role-page]').should('have.attr', 'data-ready', 'true')
}

function perm(key: string) {
  return cy.get(`[data-cy=role-perm][data-key=${key}]`)
}

describe('Roles and permissions', () => {
  it('creates a role starting from another one, and refuses a blank or taken name', () => {
    cy.seedStaffAccount().then((account) => {
      openRoles(account)
      cy.get('[data-cy=roles-new]').click()

      // Blank: the dialog says so and creates nothing.
      cy.get('[data-cy=role-new-name]').clear()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=role-new-error]').should('contain.text', 'A role needs a name.')

      // Taken, whatever the case -- and "Recepción" is the Front Desk role
      // as a Spanish-speaking owner sees it, so it is taken too.
      cy.get('[data-cy=role-new-name]').type('front DESK')
      cy.get('[data-cy=role-new-error]').should('contain.text', '"Front Desk" already exists')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=role-new-name]').clear().type('Recepción')
      cy.get('[data-cy=role-new-error]').should('contain.text', 'already exists')
      cy.task('db:roleByName', { accountId: account.accountId, name: 'front DESK' }).should('eq', null)

      cy.get('[data-cy=role-new-name]').clear().type('Gerencia')
      cy.get('[data-cy=role-new-error]').should('not.exist')
      cy.get('[data-cy=role-new-copy]').select('Front Desk')
      cy.get('[data-cy=confirm-dialog-confirm]').click()

      cy.location('pathname').should('match', /^\/settings\/roles\/[0-9a-f-]{36}$/)
      cy.get('[data-cy=role-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=role-title]').should('have.text', 'Gerencia')

      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).then((frontDesk) => {
        cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Gerencia' }).then((copy) => {
          expect(copy.permissions).to.deep.equal(frontDesk.permissions)
        })
      })

      // The database holds the line too, for another tab or another admin.
      cy.task('db:roleByName', { accountId: account.accountId, name: 'Gerencia' }).then((role: any) => {
        expect(role.name).to.eq('Gerencia')
      })
    })
  })

  it('saves a change made in plain words, and will not save a role without a name', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Practitioner' }).then((before) => {
        expect(before.permissions.inbox_access).to.eq(false)
        cy.login(account.email, account.password)
        openRole(before.roleId)

        // The label is the control's name and clicking it toggles the switch.
        perm('inbox_access')
          .find('[role=switch]')
          .should('have.attr', 'aria-checked', 'false')
          .invoke('attr', 'id')
          .then((id) => cy.get(`label[for="${id}"]`).should('have.text', 'Inbox'))
        perm('inbox_access').contains('label', 'Inbox').click()
        perm('inbox_access').find('[role=switch]').should('have.attr', 'aria-checked', 'true')
        perm('calendar_scope').find('[role=radiogroup]').should('have.attr', 'aria-labelledby')
        perm('calendar_scope').contains('[role=radio]', 'All appointments').click()
        perm('financials').contains('[role=radio]', 'Always').click()
        cy.get('[data-cy=role-description]').clear().type('Mañanas, sala 2')

        // Blank name: refused where the old page silently saved it.
        cy.get('[data-cy=role-name]').clear()
        cy.get('[data-cy=role-save]').click()
        cy.get('[data-cy=role-name-error]').should('contain.text', 'A role needs a name.')
        cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Practitioner' }).its('permissions.inbox_access').should('eq', false)

        // A name another role has: refused before it reaches the database.
        cy.get('[data-cy=role-name]').type('front desk')
        cy.get('[data-cy=role-name-error]').should('contain.text', 'already exists')

        cy.get('[data-cy=role-name]').clear().type('Practitioner')
        cy.get('[data-cy=role-save]').click()
        cy.get('[data-cy=role-save-bar]').should('not.exist')

        cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Practitioner' }).then((after) => {
          expect(after.permissions.inbox_access).to.eq(true)
          expect(after.permissions.calendar_scope).to.eq('all')
          expect(after.permissions.financials_edit_all).to.eq(true)
          expect(after.permissions.financials_edit_same_day_only).to.eq(false)
          // Nothing else moved.
          expect(after.permissions.visit_notes_access).to.eq(before.permissions.visit_notes_access)
        })
        cy.task('db:roleByName', { accountId: account.accountId, name: 'Practitioner' }).its('description').should('eq', 'Mañanas, sala 2')
      })
    })
  })

  it('lists who holds each role, and compares every permission side by side', () => {
    cy.seedStaffAccount().then((account) => {
      const stamp = Date.now()
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email: `marta-${stamp}@example.test`, password: 'Test1234!', fullName: 'Marta Ruiz' })
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email: `javier-${stamp}@example.test`, password: 'Test1234!', fullName: 'Javier López' })
      openRoles(account)

      cy.get('[data-cy=role-card][data-role-name=Practitioner]').within(() => {
        cy.get('[data-cy=role-card-count]').should('have.text', '2 people')
        cy.get('[data-cy=role-card-avatar]').should('have.length', 2).first().should('have.text', 'JL')
        cy.contains('Sees their own patients').should('exist')
        cy.contains('Reports: only their own').should('exist')
      })
      cy.get('[data-cy=role-card][data-role-name="Front Desk"] [data-cy=role-card-count]').should('have.text', 'Nobody has this role')

      cy.get('[data-cy=roles-compare]').click()
      cy.get('[data-cy=roles-compare-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=roles-compare-row][data-key=inbox_access]').within(() => {
        cy.get('td[data-role="Front Desk"]').should('have.text', 'Yes')
        cy.get('td[data-role="Practitioner"]').should('have.text', '—')
        cy.get('td[data-role="Owner"]').should('have.text', 'Yes')
      })
      cy.get('[data-cy=roles-compare-row][data-key=calendar_scope] td[data-role="Practitioner"]').should('have.text', 'Only their own')
      cy.get('[data-cy=roles-compare-row][data-key=financials] td[data-role="Front Desk"]').should('have.text', 'Same day')

      // A role's name opens it.
      cy.contains('[data-cy=roles-compare-role]', 'Practitioner').click()
      cy.get('[data-cy=role-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=role-member]').should('have.length', 2).first().should('have.attr', 'href').and('match', /^\/settings\/team\/[0-9a-f-]{36}$/)
    })
  })

  it('moves a role\'s people and pending invites to another role before deleting it', () => {
    cy.seedStaffAccount().then((account) => {
      const stamp = Date.now()
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).then((frontDesk) => {
        cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email: `temp-${stamp}@example.test`, password: 'Test1234!', fullName: 'Tina Temporal' }).then((member: any) => {
          cy.task<{ token: string }>('db:createInvite', { accountId: account.accountId, email: `invitee-${stamp}@example.test`, roleName: 'Practitioner' }).then(({ token }) => {
            cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Practitioner' }).then((practitioner) => {
              cy.login(account.email, account.password)
              openRole(practitioner.roleId)

              cy.get('[data-cy=role-delete]').click()
              cy.get('[data-cy=confirm-dialog]').should('contain.text', 'Tina Temporal').and('contain.text', '1 pending invite')
              cy.get('[data-cy=role-delete-target]').find('option').then((options) => {
                // Not itself, and not the Owner role: moving people into it
                // would hand them everything as a side effect.
                const labels = [...options].map((o) => o.textContent?.trim())
                expect(labels).to.deep.equal(['Front Desk'])
              })
              cy.get('[data-cy=role-delete-target]').select('Front Desk')
              cy.get('[data-cy=confirm-dialog-confirm]').should('contain.text', 'Move and delete').click()

              cy.location('pathname').should('eq', '/settings/roles')
              cy.task('db:roleByName', { accountId: account.accountId, name: 'Practitioner' }).should('eq', null)
              cy.task('db:roleIdsOf', { teamMemberIds: [member.teamMemberId], inviteTokens: [token] }).then((r: any) => {
                expect(r.members[0].role_id, 'the member moved').to.eq(frontDesk.roleId)
                expect(r.members[0].role).to.eq('front_desk')
                expect(r.invites[0].role_id, 'the invite moved').to.eq(frontDesk.roleId)
              })
            })
          })
        })
      })
    })
  })

  it('keeps the owner role fixed', () => {
    cy.seedStaffAccount().then((account) => {
      const ownerRole = account.roles.find((r) => r.name === 'Owner')!
      cy.login(account.email, account.password)
      openRole(ownerRole.id)
      cy.get('[data-cy=role-owner-note]').should('contain.text', 'cannot be edited')
      cy.get('[data-cy=role-name]').should('be.disabled')
      cy.get('[data-cy=role-perm-switch]').should('have.length.greaterThan', 20).each(($s) => expect($s).to.be.disabled)
      perm('inbox_access').contains('label', 'Inbox').click({ force: true })
      cy.get('[data-cy=role-save-bar]').should('not.exist')
      cy.get('[data-cy=role-delete]').should('not.exist')
    })
  })

  it('warns before someone takes away their own access to this page, then applies it at once', () => {
    cy.seedStaffAccount().then((account) => {
      const stamp = Date.now()
      const email = `admin-${stamp}@example.test`
      // A non-owner who runs the roles, on a role of their own.
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { settings_access: true, roles_admin: true, team_admin: true },
      })
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: 'Test1234!', fullName: 'Ada Admin' })
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).then((role) => {
        cy.login(email, 'Test1234!')
        openRole(role.roleId)
        cy.get('[data-cy=role-is-mine]').should('exist')

        perm('roles_admin').contains('label', 'Roles and permissions').click()
        cy.get('[data-cy=role-save]').click()
        cy.get('[data-cy=role-self-warning]').should('contain.text', 'This is your own role')

        // Cancel keeps the change unsaved.
        cy.get('[data-cy=confirm-dialog-cancel]').click()
        cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).its('permissions.roles_admin').should('eq', true)

        cy.get('[data-cy=role-save]').click()
        cy.get('[data-cy=confirm-dialog-confirm]').should('contain.text', 'Save anyway').click()
        // The store reloads, so the page they can no longer open is left at once.
        cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
        cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).its('permissions.roles_admin').should('eq', false)
        cy.visit('/settings/roles')
        cy.location('search', { timeout: 15000 }).should('eq', '?denied=1')
      })
    })
  })
})
