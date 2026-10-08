import type { StaffAccount } from '../../support/commands'

// Settings -> Activity log (20261008070424_audit_trail.sql): what changed and
// who changed it, who opened which patient's record, who signed in -- for
// owners, and for nobody else however many permissions their role has.

const PASSWORD = 'Test1234!'

function patient(account: StaffAccount, firstName: string, lastName: string) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })
}

describe('Activity log', () => {
  it('shows an owner who changed what, who opened a record, and who signed in', () => {
    cy.seedStaffAccount({ ownerName: 'Olga Owner' }).then((account) => {
      patient(account, 'Ada', 'Auditada').then((p) => {
        // A change made by a person, with the browser's own key.
        cy.task('db:writeAsStaff', { email: account.email, password: account.password, op: 'setPatientTags', patientId: p.id, tags: ['vip'] })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}`)
        cy.contains('Ada').should('be.visible')

        cy.visit('/settings/activity')
        cy.get('[data-cy=activity-log][data-ready=true]').should('exist')

        // The tag change, by the owner, with the value before and after.
        cy.get('[data-cy=activity-area]').select('patients')
        cy.contains('[data-cy=activity-change]', 'tags').should('contain', 'Olga Owner').and('contain', 'Ada Auditada')
        cy.contains('[data-cy=activity-change]', 'tags').find('[data-cy=activity-change-toggle]').click()
        cy.get('[data-cy=activity-change-detail]').should('contain', 'vip')

        // Created by the seeding task through the service role: no person.
        cy.contains('[data-cy=activity-change]', /QuiroFlow \(autom/).should('exist')

        cy.get('[data-cy=activity-tab-access]').click()
        cy.contains('[data-cy=activity-access]', 'Ada Auditada').should('contain', 'Olga Owner')

        cy.get('[data-cy=activity-tab-signins]').click()
        // cy.login signs in through the app's own client: a real session row.
        cy.contains('[data-cy=activity-signin]', 'Olga Owner').should('exist')
      })
    })
  })

  it('keeps every version of a clinical note', () => {
    cy.seedStaffAccount().then((account) => {
      patient(account, 'Nora', 'Notas').then((p) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: new Date().toISOString() }).then((appt) => {
          cy.task<{ id: string }>('db:addVisitNote', { accountId: account.accountId, appointmentId: appt.id, body: 'Primera versión' }).then((note) => {
            cy.task('db:settingsWriteAsStaff', { email: account.email, password: account.password, table: 'visit_notes', op: 'update', values: { body: 'Versión corregida' }, match: { id: note.id } })
              .its('changed')
              .should('eq', 1)
          })
        })

        cy.login(account.email, account.password)
        cy.visit('/settings/activity')
        cy.get('[data-cy=activity-area]').select('clinical')
        cy.contains('[data-cy=activity-change]', 'body').find('[data-cy=activity-change-toggle]').click()
        cy.get('[data-cy=activity-change-detail]').should('contain', 'Primera versión').and('contain', 'Versión corregida')
      })
    })
  })

  it('is refused to anyone who is not an owner, in the menu and in the database', () => {
    cy.seedStaffAccount().then((account) => {
      // The Owner ROLE -- every permission there is -- on someone who is not
      // the account's owner. Permissions are not what this page asks for.
      const email = `admin-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Owner', email, password: PASSWORD, fullName: 'Gema Gerente' })

      for (const fn of ['get_audit_log', 'get_patient_access_log', 'get_auth_events']) {
        cy.task<{ error: string | null }>('db:callRpcAs', { email, password: PASSWORD, fn, args: { p_account_id: account.accountId } })
          .its('error')
          .should('contain', 'Only an owner')
      }

      // The detail columns are not readable straight from the table either.
      cy.task<{ error: string | null }>('db:settingsWriteAsStaff', { email, password: PASSWORD, table: 'audit_logs', op: 'update', values: { summary: 'x' }, match: { account_id: account.accountId } })
        .its('changed')
        .should('eq', 0)

      cy.login(email, PASSWORD)
      cy.visit('/settings')
      cy.contains('a', 'Registro de actividad').should('not.exist')
      cy.contains('a', 'Activity log').should('not.exist')
      cy.visit('/settings/activity')
      cy.location('pathname').should('not.eq', '/settings/activity')
    })
  })
})
