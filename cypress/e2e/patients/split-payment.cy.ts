describe('Splitting a payment across methods', () => {
  it('records a single payment as separate cash + card entries and pays off the invoice', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cora', lastName: 'Cashcard' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5000 }).then(() => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          // openTakePayment() snapshots the invoice list synchronously at
          // click-time, before it's necessarily loaded -- wait for the
          // invoice to actually render in the ledger (same `invoices` fetch
          // unpaidInvoices derives from) first, or the picker opens with
          // nothing selected.
          cy.contains('INV-').should('be.visible')
          cy.contains('button', 'Take payment').click()
          cy.contains('button', 'Record payment').parents('form').as('paymentForm')

          // First row defaults to the full 50,00 € balance in cash -- split it
          // into €30 cash + €20 card instead of two separate submissions.
          cy.get('@paymentForm').find('input[type="number"]').eq(0).clear().type('30')
          cy.get('@paymentForm').contains('button', 'Split into another method').click()
          // select[0] is the invoice picker, select[1] the first row's
          // method -- the newly-added second row's method is select[2].
          cy.get('@paymentForm').find('input[type="number"]').eq(1).type('20')
          cy.get('@paymentForm').find('select').eq(2).select('Card')

          cy.get('@paymentForm').contains('Total: 50,00 €').should('be.visible')
          cy.get('@paymentForm').contains('button', 'Record payment').click()

          // The take-payment panel closes on success (activePanel resets)
          // and the invoice is fully paid off.
          cy.contains('button', 'Take payment').should('be.visible')
          cy.contains('Outstanding').parent().should('contain', '0,00 €')

          cy.contains('tr', 'Payment — cash').should('contain', '30,00 €')
          cy.contains('tr', 'Payment — card').should('contain', '20,00 €')
        })
      })
    })
  })
})
