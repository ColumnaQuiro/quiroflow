// A ledger whose queries failed used to render as "No transactions yet".
//
// Every query in loadLedger() read its result as `data ?? []`, so PostgREST
// refusing one -- a column the deployed code names and the database does not
// have yet, a policy that denies the row -- produced an empty array that is
// indistinguishable from a patient who has never been charged. It cost a day
// of RLS forensics once: invoices.refunds_payment_id shipped in the code
// against a database still missing the column, every charge vanished from the
// ledger while the payments settling those charges still rendered, and the
// running balance was recomputed from what was left. Nothing on screen said a
// query had failed.
//
// The request is stubbed rather than the schema broken, because the point is
// the UI's response to a failing query, whatever made it fail.
describe('A ledger that could not load says so', () => {
  it('shows the error instead of an empty ledger', () => {
    cy.seedStaffAccount().then((account: any) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Ledger',
        lastName: 'Failure',
      }).then((patient: any) => {
        cy.task('db:createInvoice', {
          accountId: account.accountId,
          patientId: patient.id,
          invoiceNumber: 'INV-FAIL-1',
          totalCents: 8800,
          status: 'unpaid',
        })
        cy.task('db:createPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 3000,
          method: 'cash',
        })

        cy.intercept('GET', '**/rest/v1/invoices*', {
          statusCode: 400,
          body: { code: '42703', message: 'column invoices.refunds_payment_id does not exist' },
        }).as('invoicesFail')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=money`)
        cy.wait('@invoicesFail')

        // The ledger sits below the fold on this viewport, inside a scroll
        // container -- scrolled to rather than asserted visible where it sits.
        cy.contains("Couldn't load this patient's transactions.").scrollIntoView().should('be.visible')
        cy.contains('column invoices.refunds_payment_id does not exist').should('exist')

        // Not an empty ledger, and not a partial one either: the EUR 30 that
        // did load must not be presented as this patient's whole history.
        cy.contains('No transactions yet').should('not.exist')
        cy.contains('tr', 'Payment — cash').should('not.exist')
      })
    })
  })
})
