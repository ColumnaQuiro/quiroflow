import type { StaffAccount } from '../../support/commands'

// A patient cancelling from the app or the portal used to call the RPC
// straight from the browser, which told nobody: no push, no
// appointment.cancelled automation, no waitlist offer -- the freed slot just
// sat there. It now goes through /api/portal/appointments/cancel.

function inNineDaysAtNoon() {
  const d = new Date()
  d.setDate(d.getDate() + 9)
  d.setHours(12, 0, 0, 0)
  return d
}

interface Seeded { account: StaffAccount; appointmentId: string; entryId: string; email: string; password: string }

function seed(): Cypress.Chainable<Seeded> {
  const email = `patient-cancel-${Date.now()}@example.test`
  const password = 'valencia2026'
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sergio', lastName: 'Navarro' }).then((patient) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Montse', lastName: 'Aguilar' }).then((waiting) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task('db:setPatientCancel', { accountId: account.accountId, enabled: true })
        return cy
          .task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: inNineDaysAtNoon().toISOString() })
          .then((appt) =>
            cy
              .task<{ id: string }>('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: waiting.id })
              .then((entry) => cy.wrap({ account, appointmentId: appt.id, entryId: entry.id, email, password })),
          )
      }),
    ),
  )
}

describe('A patient cancelling their own visit', () => {
  it('cancels it and offers the freed slot to the waitlist, once', () => {
    seed().then(({ appointmentId, entryId, email, password }) => {
      cy.task<string>('db:accessTokenFor', { email, password }).then((token) => {
        const cancel = () => cy.request({ method: 'POST', url: '/api/portal/appointments/cancel', headers: { Authorization: `Bearer ${token}` }, body: { appointmentId } })
        cancel().its('body').should('deep.include', { cancelled: true, offered: true })
        cy.task<{ status: string }>('db:appointmentById', { appointmentId }).its('status').should('eq', 'cancelled')
        cy.task<{ status: string }>('db:waitlistEntryById', { id: entryId }).its('status').should('eq', 'offered')
        // A repeat (a double tap, a retry) tells nobody again.
        cancel().its('body').should('deep.include', { cancelled: true, offered: false })
      })
    })
  })

  it('sends a signed-in patient to the portal, not to clinic setup', () => {
    seed().then(({ email, password }) => {
      cy.login(email, password)
      cy.visit('/')
      cy.location('pathname').should('eq', '/portal')
    })
  })
})
