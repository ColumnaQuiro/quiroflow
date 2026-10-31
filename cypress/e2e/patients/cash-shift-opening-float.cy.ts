// The change a cash drawer starts with (cash_shifts.opening_float_cents).
// "Expected in drawer" left it out, so a drawer opened with 100 € of change
// read 100 € short every day. It is entered on the shift, counted in the
// expected figure, and carried into the next shift by the database
// (cash_shift_carry_float), since most clinics keep the same change.
//
// Amounts carry a non-breaking space before €, as formatEur prints them.
describe('The cash shift’s opening change', () => {
  it('counts in the drawer and carries into the next shift', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Caja', lastName: 'Cambio' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 3000, status: 'paid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 3000, method: 'cash' })
        })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('button', 'Cash shift').click()
        cy.get('[data-cy=shift-float]').should('contain', '0,00 €')
        cy.get('[data-cy=shift-expected]').should('contain', '30,00 €')

        cy.get('[data-cy=shift-float-edit]').click()
        cy.get('[data-cy=shift-float-input]').clear().type('100,50')
        cy.get('[data-cy=shift-float-save]').click()
        cy.get('[data-cy=shift-float]').should('contain', '100,50 €')
        cy.get('[data-cy=shift-expected]').should('contain', '130,50 €')

        // Closing opens the next one at once: same change, nothing typed.
        cy.contains('button', 'Close Shift').click()
        cy.get('[data-cy=shift-float]').should('contain', '100,50 €')
        cy.task<any[]>('db:selectRows', { table: 'cash_shifts', columns: 'opening_float_cents, closed_at', match: { account_id: account.accountId } }).then((rows) => {
          expect(rows.map((r) => r.opening_float_cents)).to.deep.equal([10050, 10050])
          expect(rows.filter((r) => r.closed_at === null)).to.have.length(1)
        })
      })
    })
  })
})
