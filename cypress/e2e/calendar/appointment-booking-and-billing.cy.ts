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
          cy.clickUntil('button:contains("New Appointment")', 'input[placeholder="Search by name, phone, or email…"]')

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.get('input[placeholder="Search by name, phone, or email…"]').type('Alice')
            cy.contains('li', 'Alice Anderson').click()
            // Appointment types load async into this panel -- wait for the option
            // to actually exist rather than racing the fetch (Type select; Room/
            // Practitioner selects come after it). Its label includes the
            // effective duration, so this must match the option's exact text.
            cy.get('select').eq(0).should('contain.text', 'Consultation').select('Consultation (30 min)')
            // Exact match -- a substring match on 'Create' hits the
            // "Create Appointment" tab label (also a button, earlier in the
            // DOM) before ever reaching this actual submit button, silently
            // clicking a no-op and leaving the panel open.
            cy.contains('button', /^Create$/).click()
          })

          // Checks the panel itself is gone, not just this specific
          // placeholder -- it changes to the selected patient's name once
          // picked, so it would falsely read "gone" even with the panel
          // still open.
          cy.get('.fixed.inset-0.z-50').should('not.exist')
          cy.contains('Alice Anderson').should('be.visible')

          // The default-time appointment can land far enough down the day grid that
          // Cypress's own scroll-into-view leaves it flush under the calendar's sticky
          // column-header row -- a real (if minor) sticky-header quirk, not a broken
          // click handler, so force past it rather than asserting on exact scroll offsets.
          cy.contains('Alice Anderson').click({ force: true })
          cy.contains('h2', 'Edit Appointment').should('be.visible')

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.contains('button', 'billing').click()
            cy.contains('-- Add Service/Product --').should('be.visible')
            cy.get('select').eq(0).should('contain.text', 'Adjustment').select('Adjustment (€50.00)')

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
