// The cash shift's "Total collected" summed every payment row, including the
// two that are not money arriving: 'credit' (spending a balance paid in
// earlier, and counted then) and 'write_off' (a debt forgiven). And "Charged
// this shift" counted void receipts as if they were still charges.
//
// Amounts carry a non-breaking space before €, as formatEur prints them.
//
// The till's total is a register figure, not a balance -- nothing here
// touches how a patient's balance is worked out.
describe('The cash shift', () => {
  it('counts money that came in, and charges that still stand', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Caja', lastName: 'Turno' }).then((patient: any) => {
        // A charge that stands, paid partly in cash and partly from credit,
        // and the rest written off.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 6000, status: 'paid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 3000, method: 'cash' })
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 2000, method: 'credit' })
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 1000, method: 'write_off' })
        })
        // A charge raised in error and voided.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5000, status: 'void' })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('button', 'Cash Shift').click()

        cy.contains('Charged this shift').parent().should('contain', '60,00 €')
        // 30 in cash. Not 60: 20 of it was credit spent and 10 was forgiven.
        cy.contains('Total collected').parent().should('contain', '30,00 €')
        cy.contains('Cash payments').parent().should('contain', '30,00 €')
        // Still shown, so the shift's settlements add up -- but apart.
        cy.get('[data-cy="shift-settled-without-money"]').should('contain', '20,00 €').and('contain', '10,00 €')
      })
    })
  })
})
