// A factura is a numbered fiscal document. Deleting the payment behind it
// must not delete it.
//
// facturas.payment_id was ON DELETE CASCADE, so removing a payment destroyed
// the factura with it, silently. Four numbers are already missing from the
// 2026 series that way -- F-2026-0007, 0008, 0020 and 0027 -- because
// reception corrected a wrongly-taken payment using deletePayment, which is
// exactly what that action is for.
//
// The payment can still be deleted: this app has no rectificativa flow, so
// refusing outright would leave a known-wrong payment with no way to correct
// it. What must not happen is the document disappearing.
describe('A factura outlives the payment it documents', () => {
  it('keeps the factura, and marks it as no longer matching a payment', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fabio', lastName: 'Factura' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // Take the payment, which issues the factura.
        cy.contains('INV-').should('exist')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').as('form')
        cy.get('@form').contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'a factura was issued for the payment').to.have.length(1)
          const issued = rows[0].number

          // Now remove the payment, the way reception does when money was
          // taken that should have come from a bono.
          cy.contains('tr', 'Payment — cash').click()
          cy.contains('button', 'Remove payment').click()
          // No spinner on this action -- wait for the row itself to go.
          cy.contains('tr', 'Payment — cash').should('not.exist')

          cy.task('db:facturasFor', { patientId: patient.id }).then((after: any) => {
            // The number is still on the series. Before this change it was gone.
            expect(after, 'the factura still exists').to.have.length(1)
            expect(after[0].number).to.eq(issued)
            expect(after[0].payment_id, 'and no longer points at a payment').to.eq(null)
          })
        })

        // And it says so on screen, rather than sitting in the list looking
        // like every other factura.
        // Facturas sit behind the Money tab's sub-nav now -- it exists so the
        // account ledger gets the full width. Bonos stayed on screen because
        // selling one is an everyday action; filing a fiscal document is not.
        cy.contains('button', 'Facturas & receipts').click()
        cy.contains('payment removed').should('be.visible')
      })
    })
  })
})
