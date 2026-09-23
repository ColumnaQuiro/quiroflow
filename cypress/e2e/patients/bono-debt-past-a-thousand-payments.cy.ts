// The Debtors report reads each bono's payments to work out what is still
// owed. It used to select the whole payments table with no .range(), and
// Supabase stops an unpaged select at 1000 rows without saying so -- so on a
// ledger past that, the payments after row 1000 were never seen and a bono
// paid off with one of them was chased as a debt. The live account had 3,352
// payments and 26 on bonos when this was found; its report was over by an
// estimated 4,380 EUR, six paid-off bonos among the debtors.
describe('Debtors on a ledger past a thousand payments', () => {
  it('sees the payment that settled a bono, however far down the ledger it is', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (firstName: string, lastName: string) =>
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })

      mk('Caja', 'Diaria').then((till: any) => {
        mk('Pagado', 'Entero').then((paid: any) => {
          mk('Debe', 'Todavia').then((owing: any) => {
            // Sold here, so owed_cents is the full price and every payment
            // against the bono comes off it.
            cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: paid.id, priceCents: 30000, owedCents: 30000 }).then((bono: any) => {
              // A thousand-odd payments that have nothing to do with bonos go
              // in first, so the one that settles the bono is row 1,051.
              cy.task('db:seedManyPayments', { accountId: account.accountId, patientId: till.id, count: 1050 })
              cy.task('db:createPayment', { accountId: account.accountId, patientId: paid.id, packagePurchaseId: bono.id, amountCents: 30000, method: 'card', purpose: 'bono' })
            })
            // And one that really is unpaid, so an empty report cannot pass.
            cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: owing.id, priceCents: 12000, owedCents: 12000 })
          })
        })
      })

      cy.login(account.email, account.password)
      cy.visit('/reports/debtors')

      cy.contains('Total outstanding across 1 purchase(s)', { timeout: 15000 }).should('be.visible')
      cy.contains('tr', 'Debe Todavia').should('contain.text', '120,00')
      cy.contains('Pagado Entero').should('not.exist')
    })
  })
})
