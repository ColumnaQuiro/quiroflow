// PracticeHub records no link between a payment and an invoice, so the import
// makes none: payments arrive unallocated. But an invoice still has to say
// something in its status column, and calling 7,021 historical visits "unpaid"
// would misrepresent patients who paid in full years ago.
//
// settle_imported_invoices() decides that status by covering each patient's
// visits oldest-first out of what they actually paid -- and must do it without
// touching a single payment row, because splitting a payment across two
// invoices would mean inventing payment records PracticeHub never held.
describe('Settling imported PracticeHub invoices', () => {
  it('covers visits oldest-first, without allocating or altering any payment', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ines', lastName: 'Imported' }).then((patient: any) => {
        // Three visits of €30. The patient handed over €45 in total.
        const visits = [
          { ref: 'phinv-1', createdAt: '2026-01-01T09:00:00Z' },
          { ref: 'phinv-2', createdAt: '2026-01-02T09:00:00Z' },
          { ref: 'phinv-3', createdAt: '2026-01-03T09:00:00Z' },
        ]
        visits.forEach((v) =>
          cy.task('db:createImportedInvoice', {
            accountId: account.accountId,
            patientId: patient.id,
            totalCents: 3000,
            createdAt: v.createdAt,
            externalReference: v.ref,
          }),
        )
        cy.task('db:createImportedPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 4500,
          paidAt: '2026-01-02T10:00:00Z',
          externalReference: 'phpay-1',
        }).then((payment: any) => {
          cy.task('db:settleImportedInvoices', { accountId: account.accountId })

          // €45 covers the first €30 visit and no more: the running total at
          // the second visit is €60.
          cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-1' }).should('eq', 'paid')
          cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-2' }).should('eq', 'unpaid')
          cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-3' }).should('eq', 'unpaid')

          // The payment is untouched -- still unallocated, still one row,
          // still €45.
          cy.task('db:paymentById', { paymentId: payment.id }).then((row: any) => {
            expect(row.invoice_id, 'no invoice was attached').to.eq(null)
            expect(row.amount_cents, 'the amount was not split').to.eq(4500)
          })

          // And the balance is what it always was: €45 paid against €90
          // charged. Settling changes presentation, not money.
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)
          cy.contains('dt', 'Balance').parent().should('contain', '45,00 €')
        })
      })
    })
  })

  it('is idempotent', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ida', lastName: 'Idempotent' }).then((patient: any) => {
        cy.task('db:createImportedInvoice', {
          accountId: account.accountId,
          patientId: patient.id,
          totalCents: 5000,
          createdAt: '2026-01-01T09:00:00Z',
          externalReference: 'phinv-10',
        })
        cy.task('db:createImportedPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 8000,
          paidAt: '2026-01-01T09:00:00Z',
          externalReference: 'phpay-10',
        })
        cy.task('db:settleImportedInvoices', { accountId: account.accountId }).should('eq', 1)
        // Re-running the import must be a no-op, not a second pass of writes.
        cy.task('db:settleImportedInvoices', { accountId: account.accountId }).should('eq', 0)
      })
    })
  })
})
