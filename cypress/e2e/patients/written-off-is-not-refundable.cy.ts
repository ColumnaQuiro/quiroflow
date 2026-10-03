// A receipt's refund cap summed every payment against it, write-offs and
// credit included, so a written-off receipt offered "Refund…" for its full
// amount: cash out of the till for a debt that was forgiven, not paid. A
// single payment already followed the rule -- only money that came in can go
// back out -- and now the receipt does too.
describe('Refunding a receipt', () => {
  it('offers nothing back on a receipt that was written off', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Condo', lastName: 'Nado' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, invoiceNumber: 'INV-WO-1', totalCents: 5000, status: 'paid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 5000, method: 'write_off' })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)
          cy.contains('tr', 'INV-WO-1').should('exist').within(() => {
            cy.contains('Refund…').should('not.exist')
          })
          cy.contains('tr', 'INV-WO-1').click()
          cy.contains('a', 'Open receipt').parent().within(() => {
            cy.contains('Refund…').should('not.exist')
          })
        })
      })
    })
  })

  it('offers back only the cash on a receipt that was partly written off', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Medio', lastName: 'Condonado' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, invoiceNumber: 'INV-WO-2', totalCents: 5000, status: 'paid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 2000, method: 'cash' })
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 3000, method: 'write_off' })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)
          cy.contains('tr', 'INV-WO-2').should('exist').within(() => {
            cy.contains('button', 'Refund…').click()
          })
          cy.contains('up to 20,00 €').should('be.visible')
        })
      })
    })
  })
})
