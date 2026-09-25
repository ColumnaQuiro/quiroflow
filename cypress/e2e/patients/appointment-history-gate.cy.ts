import type { StaffAccount } from '../../support/commands'

// "Send appointment history" checked requirePermission('patients_access'), a
// key that is in no role. has_permission is false for a missing key, so
// everyone but an owner got "Missing permission: patients_access". The gate
// is now the patient itself: if you can see them, you can send them their
// history.

function staffOnRole(account: StaffAccount, roleName: string, label: string) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
  const password = 'Test1234!'
  return cy
    .task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName, email, password, fullName: label })
    .then(() => {
      cy.login(email, password)
      // cy.session() leaves the browser on a blank page; cy.request needs an
      // origin that carries the auth cookie.
      cy.visit('/dashboard')
    })
}

describe('Appointment history is gated on seeing the patient', () => {
  it('lets a Front Desk member download it and reach the send step', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Sin Correo' }).then((patient) => {
        staffOnRole(account, 'Front Desk', 'Desk')

        cy.request({ url: `/api/patients/${patient.id}/appointment-history`, encoding: 'binary', failOnStatusCode: false }).then((res) => {
          expect(res.status, 'GET appointment-history').to.eq(200)
          expect(res.headers['content-type']).to.contain('application/pdf')
        })

        // Past the gate: what stops it now is the patient having no email,
        // not a permission nobody has.
        cy.request({ method: 'POST', url: `/api/patients/${patient.id}/appointment-history/send`, failOnStatusCode: false }).then((res) => {
          expect(res.status, 'POST appointment-history/send').to.eq(400)
          expect(res.body.statusMessage).to.eq('Patient has no email address')
        })
      })
    })
  })

  it('answers 404 to a practitioner for a patient who is not theirs', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Otro', lastName: 'Paciente' }).then((patient) => {
        staffOnRole(account, 'Practitioner', 'Prac')

        cy.request({ url: `/api/patients/${patient.id}/appointment-history`, failOnStatusCode: false }).its('status').should('eq', 404)
        cy.request({ method: 'POST', url: `/api/patients/${patient.id}/appointment-history/send`, failOnStatusCode: false }).its('status').should('eq', 404)
      })
    })
  })
})
