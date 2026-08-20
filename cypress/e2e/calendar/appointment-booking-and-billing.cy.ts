describe('Appointment booking and billing checkout', () => {
  it('books an appointment, then records a payment that completes it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createServiceProduct', { accountId: account.accountId, name: 'Adjustment', priceCents: 5000 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Alice', lastName: 'Anderson' }).then(
        () => {
          cy.login(account.email, account.password)
          cy.visit('/calendar')

          // First click after a fresh visit can race Vue hydration (see commands.ts clickUntil).
          cy.clickUntil('button:contains("New Appointment")', 'h2:contains("New Appointment")')

          cy.get('.fixed.inset-0.z-20').within(() => {
            cy.get('input[placeholder="Search patients…"]').type('Alice')
            cy.contains('li', 'Alice Anderson').click()
            cy.get('select').eq(0).select('Consultation') // Type select (Room/Practitioner selects come after it)
            cy.contains('button', 'Save').click()
          })

          cy.contains('h2', 'New Appointment').should('not.exist')
          cy.contains('Alice Anderson').should('be.visible')

          cy.contains('Alice Anderson').click()
          cy.contains('h2', 'Edit Appointment').should('be.visible')

          cy.get('.fixed.inset-0.z-20').within(() => {
            cy.contains('button', 'billing').click()
            cy.contains('-- Add Service/Product --').should('be.visible')
            cy.get('select').eq(0).select('Adjustment (€50.00)')

            cy.contains('Total: €50.00').should('be.visible')
            cy.contains('Balance due: €50.00').should('be.visible')

            cy.contains('button', 'Process').click()

            cy.contains('paid', { matchCase: false }).should('be.visible')
            cy.contains('Balance due: €0.00').should('be.visible')
          })
        },
      )
    })
  })
})
