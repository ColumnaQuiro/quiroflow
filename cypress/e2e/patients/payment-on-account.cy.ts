// A payment does not need an invoice.
//
// Until 0170 payments.invoice_id was NOT NULL, so every payment had to settle
// a charge and the only way to know whose money it was was to follow the
// invoice. PracticeHub keeps the two apart -- and on the live account 208
// patients have paid EUR 32,213.50 more than they were ever invoiced, money
// that has no invoice to attach to. The old shape could only represent that by
// inventing an invoice per payment, which is what the re-migration removes.
//
// So: money on account has to count towards the balance, show in the ledger,
// and survive its invoice being deleted.
describe('A payment with no invoice', () => {
  it('counts towards the balance and appears in the ledger', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ona', lastName: 'Onaccount' }).then((patient: any) => {
        // EUR 50 handed over with nothing charged for it yet.
        cy.task('db:createPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 5000,
          method: 'cash',
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // Nothing invoiced, EUR 50 paid: the clinic owes the patient EUR 50.
        // Before this change the payment was invisible -- the balance read
        // through an inner join to invoices, which it has none of.
        cy.contains('dt', 'Balance').parent().should('contain', '50,00 €')

        // And it is visible as an event, not just as a number: the ledger
        // matches a payment to its invoice by invoice_id, and this one has
        // none.
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('Payment — cash').scrollIntoView().should('be.visible')
      })
    })
  })

  it('nets off against a later invoice, without being allocated to it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nel', lastName: 'Netoff' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'cash' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 3000, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // 50 paid, 30 charged. The invoice stays unpaid -- nothing was
        // allocated to it, exactly as PracticeHub records it -- but the
        // patient is EUR 20 in credit overall.
        cy.contains('dt', 'Balance').parent().should('contain', '20,00 €')
      })
    })
  })

  it('survives the invoice it settled being deleted', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sur', lastName: 'Survivor' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5500, status: 'paid' }).then((invoice: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: invoice.id, amountCents: 5500, method: 'cash' }).then((payment: any) => {
            // Deleting the charge used to cascade the payment away with it --
            // which is why usePackageSession() had to refuse to clean up an
            // invoice that had been paid. The money outlives the charge now.
            cy.task('db:deleteInvoice', { invoiceId: invoice.id })
            cy.task('db:paymentById', { paymentId: payment.id }).then((row: any) => {
              expect(row, 'the payment still exists').to.not.eq(null)
              expect(row.invoice_id, 'no longer attached to a charge').to.eq(null)
              expect(row.patient_id, 'still knows whose money it is').to.eq(patient.id)
            })
          })
        })
      })
    })
  })
})
