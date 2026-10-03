// "Book visit" on a patient's page used to land on a bare calendar, and the
// patient the receptionist was looking at had to be searched for all over
// again. The calendar now carries them: the slot is still picked on the grid,
// but the new-appointment panel opens with that patient already chosen.
describe('Booking from a patient page', () => {
  it('opens the new appointment with that patient chosen, until told otherwise', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Marín' }).then((patient) => {
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 8', sessionsTotal: 8, sessionsUsed: 2 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.contains('button', 'Book visit').click()

        cy.location('pathname', { timeout: 15000 }).should('eq', '/calendar')
        cy.location('search').should('include', `patient=${patient.id}`)
        cy.get('[data-cy=booking-for]').should('contain.text', 'Booking for Lucía Marín')

        cy.get('[data-testid="practitioner-tabs"]').contains('button', 'Test Owner').should('be.visible')
        cy.clickUntil('button:contains("New Appointment")', '[data-cy=create-sheet]')
        cy.get('[data-cy=create-sheet]').within(() => {
          // Chosen, and described the way a search result would be.
          cy.get('[data-cy=create-patient-selected]').should('contain.text', 'Lucía Marín').and('contain.text', 'Bono 6/8')
          cy.get('[data-cy=create-patient-search]').should('not.exist')
        })
        cy.get('[data-cy=create-sheet] button[aria-label="Close"]').click()
        cy.get('[data-cy=create-sheet]').should('not.exist')

        // The x goes back to booking for anyone.
        cy.get('[data-cy=booking-for-clear]').click()
        cy.get('[data-cy=booking-for]').should('not.exist')
        cy.location('search').should('not.include', 'patient=')
        cy.clickUntil('button:contains("New Appointment")', '[data-cy=create-patient-search]')
        cy.get('[data-cy=create-patient-selected]').should('not.exist')
      })
    })
  })
})
