// Paying an invoice in full has to leave it marked paid.
//
// INV-3500: EUR 50 charged, EUR 50 taken by card 38 seconds later, factura
// issued -- and the invoice still sat at 'unpaid'. One row out of 7,101, so
// not a broken feature, but a silent failure in both directions: the patient
// is never chased, and Billing keeps listing the money as owed.
//
// Four screens each decided for themselves whether a payment had settled an
// invoice. Two of them (the appointment dialog and /billing/[id]) compared
// against totals loaded when the screen opened rather than re-reading them,
// and none of the four checked whether the write succeeded -- an update()
// with no .select() returns no rows and an error nobody reads. That is now
// one function, utils/settleInvoice, which asks the database both questions.
//
// This is the net under that refactor: the flip still happens, from the
// screen most payments are taken on.
describe('Paying an invoice in full', () => {
  it('leaves the invoice marked paid', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iara', lastName: 'Integra' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5000, status: 'unpaid' }).then((invoice: any) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          // Wait for the invoice list itself: openTakePayment() snapshots it
          // synchronously, and the outstanding total is on screen before the
          // list has loaded.
          cy.contains('INV-').should('exist')
          cy.contains('button', 'Take payment').click()
          cy.contains('button', 'Record payment').parents('form').as('form')
          // The first row already defaults to the full balance in cash.
          cy.get('@form').contains('button', 'Record payment').click()
          cy.contains('button', 'Recording…').should('not.exist')

          cy.task('db:invoiceById', { invoiceId: invoice.id }).then((row: any) => {
            expect(row.status, 'settled by its own payment').to.eq('paid')
          })
        })
      })
    })
  })
})
