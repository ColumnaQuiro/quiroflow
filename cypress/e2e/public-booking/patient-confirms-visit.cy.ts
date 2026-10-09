// A reminder can now reach a patient as an app push, which has no reply --
// so "Confirmar asistencia" in the app and the portal records what a WhatsApp
// "sí" does: confirmation_status 'confirmed' (confirm_my_appointment).

function inDays(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

describe('A patient confirming their visit', () => {
  it('confirms one coming up this week, and is not asked about one months away', () => {
    const email = `confirm-visit-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Soler' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: inDays(3) }).then((soon) => {
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: inDays(60) })

          cy.login(email, password)
          cy.visit('/portal/appointments')
          // Only the one this week asks.
          cy.get('[data-cy="patient-confirm-visit"]').should('have.length', 1).click()
          cy.get('[data-cy="patient-visit-confirmed"]').should('contain.text', 'Attendance confirmed')
          cy.task<{ confirmation_status: string | null }>('db:appointmentById', { appointmentId: soon.id }).its('confirmation_status').should('eq', 'confirmed')

          // And it stays confirmed when the page is read again.
          cy.reload()
          cy.get('[data-cy="patient-visit-confirmed"]').should('be.visible')
          cy.get('[data-cy="patient-confirm-visit"]').should('not.exist')
        })
      })
    })
  })
})
