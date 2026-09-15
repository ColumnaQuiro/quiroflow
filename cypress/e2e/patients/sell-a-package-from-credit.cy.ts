// Paying for a bono out of money the patient already has with the clinic.
//
// The option existed but was gated on creditLedgerCents, which counts only
// account_credits rows -- three patients in the whole database have one, so
// in practice it never appeared and paying from credit looked like something
// the app couldn't do. Meanwhile the same tab shows "Available" as
// creditLedgerCents + bonoValueCents, so a patient could plainly be in credit
// on screen while the dropdown offered only Cash and Card.
//
// The catch is that most of that money usually isn't spendable. A bono raises
// no invoice -- its price sits on the purchase and each visit draws it down --
// so the money paid for it reads as a positive balance until the sessions are
// used. Spending that on a second bono would leave the first one's sessions
// unfunded.
//
// These two cases are the same EUR 528 sitting on the account, and the right
// answer is opposite in each.
describe('Selling a package from account credit', () => {
  it('spends a genuine overpayment, and draws the credit down', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Overpaid' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })
        // Money on account settling no particular charge, and no bono to be
        // committed to -- so all of it is spendable.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 10000, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('select', 'Sell a package').should('exist').select('Bono 12 (12, €528.00)')

        // Part-paying is the normal case: EUR 100 of credit against a EUR 528
        // bono, the rest taken later or put on autopay. The guard compares
        // against what is being paid now, not the package's price.
        cy.get('input[type="number"]').last().clear().type('100')
        cy.contains('label', 'Method').parent().find('select').as('method')
        cy.get('@method').find('option[value="credit"]').should('not.be.disabled').should('contain.text', '€100.00')
        cy.get('@method').select('credit')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        // Spending credit is not a new fiscal event -- that money was
        // documented when it was paid in.
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'no factura for a credit payment').to.have.length(0)
        })

        // And the credit is actually drawn down rather than spendable twice.
        cy.contains('tr', 'Applied to Bono 12').should('exist')
      })
    })
  })

  it('refuses money already committed to an unused bono', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Bonoheld' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })
        // Prepaid a bono in full and used none of it: EUR 528 on the account,
        // every cent of it already buying those twelve sessions.
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 12', sessionsTotal: 12, sessionsUsed: 0, priceCents: 52800, owedCents: 0 })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 52800, method: 'card' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // The tab says they have EUR 528 available -- which is true, and is
        // exactly why the dropdown has to disagree.
        cy.contains('Available').parent().should('contain.text', '€528.00')

        cy.contains('select', 'Sell a package').should('exist').select('Bono 12 (12, €528.00)')
        cy.contains('label', 'Method').parent().find('select').as('method')
        // Shown, so it is clear the feature exists, but not selectable.
        cy.get('@method').find('option[value="credit"]').should('be.disabled').should('contain.text', 'none available')
      })
    })
  })
})
