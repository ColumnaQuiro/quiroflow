import { todayAt } from '../../support/calendar'

// "Ver progreso" (progress_access): the Progreso tab -- pain visit by visit,
// what was adjusted, posture -- for a role that must not read the clinical
// notes. It used to sit behind "Ver notas de visita" with no switch of its
// own, so reception could not be shown a patient's progress without being
// handed every note, and Settings > Roles never mentioned the tab.

const PASSWORD = 'valencia2026'
const daysAgo = (d: number) => {
  const at = new Date(todayAt(10, 0))
  at.setDate(at.getDate() - d)
  return at.toISOString()
}

type Role = { roleId: string; permissions: Record<string, unknown> }

describe('Progress permission', () => {
  it('lets reception read the Progress tab without the visit notes, and only when the role says so', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Irene', lastName: 'Progreso' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysAgo(7), status: 'completed' }).then((appt) => {
          cy.task('db:insertRows', { table: 'visit_pain_scores', rows: [{ account_id: account.accountId, appointment_id: appt.id, practitioner_score: 6 }] })
          cy.task('db:insertRows', { table: 'visit_notes', rows: [{ account_id: account.accountId, appointment_id: appt.id, body: 'Nota clínica privada' }] })

          const email = `progress-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
          cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { patients_scope: 'all', visit_notes_access: false, progress_access: false } })
          cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Recepción' })

          // Without it: no tab, and the database hands back nothing either.
          cy.login(email, PASSWORD)
          cy.visit(`/patients/${patient.id}`)
          cy.get('#tab-overview').should('be.visible')
          cy.get('#tab-progress').should('not.exist')
          cy.task<{ rows: unknown[] }>('db:selectAsStaff', { email, password: PASSWORD, table: 'visit_pain_scores', inColumn: 'appointment_id', inValues: [appt.id] }).its('rows').should('have.length', 0)

          // With it: the tab and the scores, still not a word of the notes,
          // and nothing that writes.
          cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { progress_access: true } })
          cy.task<{ rows: unknown[] }>('db:selectAsStaff', { email, password: PASSWORD, table: 'visit_pain_scores', inColumn: 'appointment_id', inValues: [appt.id] }).its('rows').should('have.length', 1)
          cy.task<{ rows: unknown[] }>('db:selectAsStaff', { email, password: PASSWORD, table: 'visit_notes', inColumn: 'appointment_id', inValues: [appt.id] }).its('rows').should('have.length', 0)
          cy.visit(`/patients/${patient.id}`)
          cy.get('#tab-progress').should('be.visible').click()
          cy.get('[data-cy=progress-tab][data-ready=true]', { timeout: 20000 })
          cy.get('[data-cy=progress-latest]').should('contain', '6')
          cy.get('[data-cy=progress-row]').should('have.length', 1)
          cy.get('[data-cy=posture-new]').should('not.exist')
        })
      })
    })
  })

  it('shows "See progress" in Roles, held by notes and switchable on its own', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)

      // Practitioner reads the notes, which include progress: on, and not a
      // switch that can say otherwise.
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Practitioner' }).then((role) => {
        expect(role.permissions.progress_access, 'Practitioner sees progress').to.eq(true)
        cy.visit(`/settings/roles/${role.roleId}`)
        cy.get('[data-cy=role-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=role-perm][data-key=progress_access] [data-cy=role-perm-switch]').should('have.attr', 'aria-checked', 'true').and('be.disabled')
      })

      // Front Desk starts without it and gets it with one switch, notes untouched.
      cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).then((role) => {
        expect(role.permissions.progress_access, 'Front Desk sees progress by default').to.eq(false)
        cy.visit(`/settings/roles/${role.roleId}`)
        cy.get('[data-cy=role-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=role-perm][data-key=progress_access]').should('contain', 'See progress')
        cy.get('[data-cy=role-perm][data-key=progress_access] [data-cy=role-perm-switch]').should('have.attr', 'aria-checked', 'false').click()
        cy.get('[data-cy=role-save]').click()
        cy.get('[data-cy=role-save-bar]').should('not.exist')
        cy.task<Role>('db:rolePermissions', { accountId: account.accountId, roleName: 'Front Desk' }).then((after) => {
          expect(after.permissions.progress_access).to.eq(true)
          expect(after.permissions.visit_notes_access).to.eq(false)
        })
      })
    })
  })
})
