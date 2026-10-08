// A patient's lists (visits, documents, invoices, facturas) read their rows
// straight from the database, and a failed read used to land as an empty
// list: offline, the portal and the app told a patient "No upcoming
// appointments" about visits they had. A failure now says so, with a retry,
// and keeps whatever was already shown.

describe("A patient's list that failed to load", () => {
  it('says it could not load, not that there is nothing, and recovers on retry', () => {
    const email = `patient-list-error-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Ferrer' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        const inTwoWeeks = new Date(Date.now() + 14 * 86400_000)
        inTwoWeeks.setHours(12, 0, 0, 0)
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: inTwoWeeks.toISOString() })
      })
    })

    cy.login(email, password)
    // Every read fails until the retry below; after signing in, because
    // landing on the portal reads the visits too.
    let failing = true
    cy.intercept({ method: 'GET', url: '**/rest/v1/appointments*' }, (req) => {
      if (failing) req.reply({ statusCode: 500, body: { message: 'failed' } })
      else req.continue()
    })
    cy.visit('/portal/appointments')

    cy.get('[data-cy="patient-load-error"]').should('have.length.at.least', 1).first().should('be.visible')
    cy.contains('No upcoming appointments').should('not.exist')

    cy.then(() => {
      failing = false
    })
    cy.get('[data-cy="patient-load-error"]').first().contains('button', 'Try again').click()
    cy.get('[data-cy="patient-load-error"]').should('not.exist')
    cy.contains('No upcoming appointments').should('not.exist')
    // The visit itself, by its practitioner: its time is drawn in the clinic's
    // zone, which is not the CI runner's.
    cy.contains('Test Owner').should('be.visible')
  })
})
