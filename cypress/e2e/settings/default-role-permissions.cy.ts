// What a brand-new clinic's default roles are allowed to do.
//
// All three used to be handed the same jsonb, so "Front Desk" arrived holding
// roles_admin, team_admin, data_admin and full access to appointment notes.
// These assert the separation that replaced it, against a real account created
// through the same RPC onboarding uses.

/** Every permission an ordinary role has no business holding by default. */
const ADMIN_KEYS = [
  'settings_access',
  'roles_admin',
  'team_admin',
  'clinic_config',
  'billing_config',
  'communication_config',
  'data_admin',
  'developers_access',
] as const

/** Irreversible things: a default role may create and edit, not destroy. */
const DESTRUCTIVE_KEYS = ['patients_delete_merge', 'patient_docs_delete', 'patient_files_delete'] as const

type Role = { permissions: Record<string, unknown>; isSystem: boolean }

describe('Default role permissions', () => {
  it('gives neither default role any administrative access', () => {
    cy.seedStaffAccount().then((account) => {
      for (const roleName of ['Practitioner', 'Front Desk']) {
        cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName }).then((role) => {
          for (const key of ADMIN_KEYS) {
            expect(role.permissions[key], `${roleName}.${key}`).to.eq(false)
          }
          for (const key of DESTRUCTIVE_KEYS) {
            expect(role.permissions[key], `${roleName}.${key}`).to.eq(false)
          }
        })
      }
    })
  })

  it('keeps clinical notes out of the Front Desk role and in the Practitioner one', () => {
    // The reason the two roles exist separately. A receptionist books, charges
    // and messages; appointment notes are the most sensitive data here and
    // they have no clinical reason to read them.
    cy.seedStaffAccount().then((account) => {
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).then((role) => {
        expect(role.permissions.visit_notes_access, 'Front Desk sees clinical notes').to.eq(false)
        expect(role.permissions.visit_notes_edit).to.eq(false)
        expect(role.permissions.visit_notes_delete).to.eq(false)
      })

      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Practitioner' }).then((role) => {
        expect(role.permissions.visit_notes_access, 'Practitioner sees clinical notes').to.eq(true)
        expect(role.permissions.visit_notes_scope, 'and only their own').to.eq('own')
        // Can write them up, cannot erase the record afterwards.
        expect(role.permissions.visit_notes_edit).to.eq(true)
        expect(role.permissions.visit_notes_delete).to.eq(false)
      })
    })
  })

  it('scopes a practitioner to their own work and front desk to the whole clinic', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Practitioner' }).then((role) => {
        expect(role.permissions.calendar_scope).to.eq('own')
        expect(role.permissions.patients_scope).to.eq('own')
        expect(role.permissions.reports_own_only).to.eq(true)
        expect(role.permissions.docs_files_scope, 'own paperwork too').to.eq('own')
      })

      // Booking for whoever walks in is the job, so this one is deliberately
      // account-wide -- the separation is over settings and notes, not reach.
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).then((role) => {
        expect(role.permissions.calendar_scope).to.eq('all')
        expect(role.permissions.patients_scope).to.eq('all')
        expect(role.permissions.inbox_access).to.eq(true)
        expect(role.permissions.payments_allocate).to.eq(true)
        // Chasing consent forms and insurance paperwork across the whole
        // patient list IS the job, and this role authors nothing, so scoping
        // documents by author would only break it.
        expect(role.permissions.docs_files_scope).to.eq('all')
      })
    })
  })

  it('leaves the Owner role holding everything', () => {
    // The control. Without it, a change that emptied every role would pass
    // all three tests above.
    cy.seedStaffAccount().then((account) => {
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Owner' }).then((role) => {
        expect(role.isSystem, 'Owner is a system role').to.eq(true)
        for (const key of [...ADMIN_KEYS, ...DESTRUCTIVE_KEYS]) {
          expect(role.permissions[key], `Owner.${key}`).to.eq(true)
        }
        expect(role.permissions.visit_notes_access).to.eq(true)
        expect(role.permissions.patients_scope).to.eq('all')
        expect(role.permissions.docs_files_scope).to.eq('all')
      })
    })
  })

  it('stops a Front Desk member reaching Settings at all', () => {
    // The stored jsonb asserted above only matters if the app enforces it, so
    // this drives the real UI with a real session on the default role --
    // unlike rbac-roles.cy.ts, which narrows the role by hand first.
    cy.seedStaffAccount().then((account) => {
      const staffEmail = `frontdesk-default-${Date.now()}@example.test`
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
        cy.contains('a', 'Settings').should('not.exist')

        cy.visit('/settings')
        cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
        cy.location('search').should('eq', '?denied=1')
      })
    })
  })
})
