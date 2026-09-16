// A child drawing sessions from a parent's bono has no payments of their own.
//
// settle_imported_invoices() used to cover each patient's imported visits out
// of THEIR OWN payments, so the child's running total always exceeded zero and
// every visit they ever took read as unpaid, forever. On the live account that
// was 34 beneficiaries, 131 invoices and €5,628 of debt nobody owed -- money
// the Debtors report was asking the clinic to chase.
//
// Settlement pools by family now: the connected component of the sharing
// graph, payments and invoices together, still oldest-first.
describe('Settling imported invoices for a shared bono', () => {
  it('pays a beneficiary’s visits out of the family’s money, and still leaves real debt unpaid', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (firstName: string, lastName: string) =>
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })

      mk('Padre', 'Paga').then((parent: any) => {
        mk('Hija', 'Comparte').then((child: any) => {
          mk('Ajena', 'Debe').then((stranger: any) => {
            // The parent buys a bono and shares it with the child.
            cy.task('db:createPackagePurchase', {
              accountId: account.accountId,
              patientId: parent.id,
              packageName: 'Bono 12',
              sessionsTotal: 12,
              sessionsUsed: 2,
              priceCents: 52800,
              owedCents: 0,
            }).then((pkg: any) => {
              cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: pkg.id, patientId: child.id })

              // Only the parent ever hands over money.
              cy.task('db:createImportedPayment', { accountId: account.accountId, patientId: parent.id, amountCents: 52800, paidAt: '2026-01-01T08:00:00Z', externalReference: 'phpay-fam-1' })

              cy.task('db:createImportedInvoice', { accountId: account.accountId, patientId: parent.id, totalCents: 4400, createdAt: '2026-01-01T09:00:00Z', externalReference: 'phinv-fam-1' })
              // The child's visit: covered by the shared bono, so it must not
              // be left as a debt against a patient who has never paid a cent.
              cy.task('db:createImportedInvoice', { accountId: account.accountId, patientId: child.id, totalCents: 4400, createdAt: '2026-01-02T09:00:00Z', externalReference: 'phinv-fam-2' })
              // Unrelated to the family and genuinely unpaid.
              cy.task('db:createImportedInvoice', { accountId: account.accountId, patientId: stranger.id, totalCents: 4400, createdAt: '2026-01-03T09:00:00Z', externalReference: 'phinv-fam-3' })

              cy.task('db:settleImportedInvoices', { accountId: account.accountId })

              cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-fam-1' }).then((s) => expect(s, "the parent's own visit").to.eq('paid'))
              cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-fam-2' }).then((s) => expect(s, "the child's visit, from the shared bono").to.eq('paid'))
              cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-fam-3' }).then((s) =>
                expect(s, 'someone outside the family who really does owe').to.eq('unpaid'),
              )
            })
          })
        })
      })
    })
  })

  it('stops once the family has spent what it actually paid', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Madre', lastName: 'Corta' }).then((parent: any) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Hijo', lastName: 'Corto' }).then((child: any) => {
          cy.task('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: parent.id,
            packageName: 'Bono 12',
            sessionsTotal: 12,
            sessionsUsed: 0,
            priceCents: 52800,
            owedCents: 0,
          }).then((pkg: any) => {
            cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: pkg.id, patientId: child.id })
            // €100 between them, against €132 of visits.
            cy.task('db:createImportedPayment', { accountId: account.accountId, patientId: parent.id, amountCents: 10000, paidAt: '2026-01-01T08:00:00Z', externalReference: 'phpay-short-1' })
            cy.task('db:createImportedInvoice', { accountId: account.accountId, patientId: child.id, totalCents: 4400, createdAt: '2026-02-01T09:00:00Z', externalReference: 'phinv-short-1' })
            cy.task('db:createImportedInvoice', { accountId: account.accountId, patientId: child.id, totalCents: 4400, createdAt: '2026-02-02T09:00:00Z', externalReference: 'phinv-short-2' })
            cy.task('db:createImportedInvoice', { accountId: account.accountId, patientId: parent.id, totalCents: 4400, createdAt: '2026-02-03T09:00:00Z', externalReference: 'phinv-short-3' })

            cy.task('db:settleImportedInvoices', { accountId: account.accountId })

            cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-short-1' }).then((s) => expect(s).to.eq('paid'))
            cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-short-2' }).then((s) => expect(s).to.eq('paid'))
            // €132 cumulative against €100 paid: this one is real debt.
            cy.task('db:invoiceStatusByRef', { accountId: account.accountId, externalReference: 'phinv-short-3' }).then((s) =>
              expect(s, 'pooling must not invent money the family never paid').to.eq('unpaid'),
            )
          })
        })
      })
    })
  })
})
