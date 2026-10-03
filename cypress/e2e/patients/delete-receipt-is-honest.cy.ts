// "Delete receipt" promised to remove the payments recorded against it. Since
// 0170 payments.invoice_id is ON DELETE SET NULL, so it did no such thing: the
// receipt went, its payments stayed as unallocated money on account, and the
// patient's balance moved by the whole charge with nothing on screen to say
// why. A delete the database refused was not noticed either.
//
// So a receipt with money against it is not deleted at all -- the payments are
// removed or refunded first, deliberately -- and the dialog says what a delete
// actually does.
function openReceiptRow(invoiceNumber: string) {
  cy.contains('tr', invoiceNumber).should('exist').click()
}

describe('Deleting a receipt', () => {
  it('refuses one that has payments, and leaves both where they were', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Recibo', lastName: 'Pagado' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, invoiceNumber: 'INV-DEL-1', totalCents: 5000, status: 'paid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 5000, method: 'cash' }).then((payment: any) => {
            const confirms: string[] = []
            cy.on('window:confirm', (text) => {
              confirms.push(text)
              return true
            })

            cy.login(account.email, account.password)
            cy.visit(`/patients/${patient.id}?tab=billing`)
            openReceiptRow('INV-DEL-1')
            cy.contains('a', 'Open receipt').parent().find('button[aria-label="Delete"]').click()

            cy.contains('has payments recorded against it').should('be.visible')
            cy.wrap(confirms).should('have.length', 0)
            cy.task('db:invoiceById', { invoiceId: inv.id }).should('not.eq', null)
            cy.task('db:paymentById', { paymentId: payment.id }).then((row: any) => {
              expect(row.invoice_id, 'still settling its receipt').to.eq(inv.id)
            })
          })
        })
      })
    })
  })

  it('deletes one with nothing against it, and says only what it does', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Recibo', lastName: 'Erroneo' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, invoiceNumber: 'INV-DEL-2', totalCents: 5000, status: 'unpaid' }).then((inv: any) => {
          const confirms: string[] = []
          cy.on('window:confirm', (text) => {
            confirms.push(text)
            return true
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)
          openReceiptRow('INV-DEL-2')
          cy.contains('a', 'Open receipt').parent().find('button[aria-label="Delete"]').click()

          cy.contains('tr', 'INV-DEL-2').should('not.exist')
          cy.task('db:invoiceById', { invoiceId: inv.id }).should('eq', null)
          cy.wrap(confirms).should('have.length', 1)
          cy.wrap(confirms).its(0).should('not.contain', 'removes any payments')
        })
      })
    })
  })
})
