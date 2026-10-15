// A bono shared between two people is paid by both of them.
//
// The front desk records each payment on whoever hands it over and links it to
// the bono. The owner's card read only the owner's own payments, so a couple's
// 1,200 EUR family bono, paid 60 by each and 600 more by the owner, read "660
// paid" where 720 had been -- the beneficiary's 60 sat on the beneficiary's
// record and never reached the bono's figure. The Debtors report, which reads
// every linked payment in the account, had it right all along.
describe('A shared bono paid by both people sharing it', () => {
  it('counts what each of them paid towards it on the owner’s card', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (firstName: string, lastName: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })
      mk('Titular', 'Pareja').then((owner) => {
        mk('Beneficiario', 'Pareja').then((partner) => {
          cy.task<{ id: string }>('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: owner.id,
            packageName: 'Bono Familiar 30',
            sessionsTotal: 30,
            sessionsUsed: 4,
            priceCents: 120000,
            owedCents: 120000,
          }).then((pkg) => {
            cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: pkg.id, patientId: partner.id })
            const pay = (patientId: string, amountCents: number) =>
              cy.task('db:createPayment', { accountId: account.accountId, patientId, amountCents, method: 'card', purpose: 'bono', packagePurchaseId: pkg.id })
            pay(owner.id, 6000)
            pay(partner.id, 6000)
            pay(owner.id, 60000)

            cy.login(account.email, account.password)
            cy.visit(`/patients/${owner.id}?tab=billing`)
            cy.contains('720,00 € paid of 1200,00 €').scrollIntoView().should('be.visible')
            cy.contains('660,00 €').should('not.exist')
            // And the linked payments add up to that figure, naming whose
            // record the partner's was taken on.
            cy.contains('button', 'Link payment').click()
            cy.contains('paid by Beneficiario Pareja').should('be.visible')
          })
        })
      })
    })
  })
})
