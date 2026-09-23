// The other half of shared-bono-settles-the-family.
//
// Settlement pools by family, so a beneficiary's IMPORTED visits read 'paid'.
// The live charge path never learned the same thing: logging a session raises
// a charge at the bono's per-session rate and marks it paid when the money is
// already on the account -- and it asked that question of ONE patient. A
// family bono's money sits on the owner's record, so a beneficiary's own
// balance is negative by construction, the check could never pass, and their
// visit was billed even though the family had prepaid for it.
//
// Santiago Nawab, 23 Sep 2026: a session came off Henna's Bono 12 and
// INV-3576 for 44 EUR was raised 0.3s later, unpaid. His own balance was
// -173 EUR; his family's was +44, exactly the session just drawn.
describe('Logging a session from a shared bono', () => {
  it('charges it to the family’s money, not to the beneficiary’s own balance', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (firstName: string, lastName: string) =>
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })

      mk('Padre', 'Comparte').then((parent: any) => {
        mk('Hija', 'Recibe').then((child: any) => {
          // A 528 EUR bono, eleven of twelve sessions already taken.
          cy.task('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: parent.id,
            packageName: 'Bono 12',
            sessionsTotal: 12,
            sessionsUsed: 11,
            priceCents: 52800,
            owedCents: 0,
          }).then((pkg: any) => {
            cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: pkg.id, patientId: child.id })

            // Only the parent ever hands money over, and the eleven visits
            // already taken have been charged against it. That leaves the
            // family exactly one session ahead -- 528 - 484 = 44 -- which is
            // the shape the Nawab family was in.
            cy.task('db:createPayment', { accountId: account.accountId, patientId: parent.id, amountCents: 52800, method: 'cash', purpose: 'bono' })
            cy.task('db:createInvoice', { accountId: account.accountId, patientId: parent.id, totalCents: 48400, status: 'paid' })

            cy.login(account.email, account.password)
            cy.visit(`/patients/${child.id}?tab=billing`)

            // The child draws the twelfth session. Her own balance is 0, well
            // under the 44 EUR this costs, so the per-patient check this
            // replaces would have billed her for it.
            cy.contains('[data-cy="bono-card"]', 'Bono 12').within(() => {
              cy.contains('button', 'Log session').click()
            })

            cy.task('db:invoicesFor', { patientId: child.id }).then((invoices: any) => {
              expect(invoices, 'one charge for the visit just logged').to.have.length(1)
              expect(invoices[0].total_cents, "the bono's per-session rate").to.eq(4400)
              expect(invoices[0].status, 'the family had already paid for this session').to.eq('paid')
            })
          })
        })
      })
    })
  })

  it('still leaves the charge unpaid when the family really is short', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (firstName: string, lastName: string) =>
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })

      mk('Madre', 'Debe').then((parent: any) => {
        mk('Hijo', 'Recibe').then((child: any) => {
          cy.task('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: parent.id,
            packageName: 'Bono 12',
            sessionsTotal: 12,
            sessionsUsed: 0,
            priceCents: 52800,
            owedCents: 42800,
          }).then((pkg: any) => {
            cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: pkg.id, patientId: child.id })

            // 100 EUR down on the bono, 80 of it already spent on visits: the
            // family has 20 EUR, and this session costs 44. Pooling must not
            // invent the difference.
            cy.task('db:createPayment', { accountId: account.accountId, patientId: parent.id, amountCents: 10000, method: 'cash', purpose: 'bono' })
            cy.task('db:createInvoice', { accountId: account.accountId, patientId: parent.id, totalCents: 8000, status: 'paid' })

            cy.login(account.email, account.password)
            cy.visit(`/patients/${child.id}?tab=billing`)

            cy.contains('[data-cy="bono-card"]', 'Bono 12').within(() => {
              cy.contains('button', 'Log session').click()
            })

            cy.task('db:invoicesFor', { patientId: child.id }).then((invoices: any) => {
              expect(invoices, 'one charge for the visit just logged').to.have.length(1)
              expect(invoices[0].status, 'real debt stays debt').to.eq('unpaid')
            })
          })
        })
      })
    })
  })
})
