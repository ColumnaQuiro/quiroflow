// A bono that came over from PracticeHub said "Paid" while PracticeHub said
// the patient still owed half of it.
//
// July Pedraza bought a €528 Bono 12 and paid €264. In PracticeHub the bono
// itself carries the outstanding €264. On this side it carried nothing: the
// re-migration deleted the invoices bonos used to be billed on, and payments
// come across unallocated because PracticeHub allocates them to nothing --
// so the card had neither of the two things it worked the debt out from, and
// fell through to "Paid". 200 active bonos were in that state.
describe('A bono migrated from PracticeHub', () => {
  it('shows what PracticeHub says is still owed, with no invoice behind it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'July', lastName: 'Migrada' }).then((patient: any) => {
        // Her €264 is in this ledger too, imported and unallocated. It must
        // NOT come off the outstanding figure: PracticeHub's €264 is already
        // net of it, so subtracting it again would clear a real debt.
        cy.task('db:createImportedPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 26400,
          paidAt: new Date().toISOString(),
          externalReference: 'phpay-3452',
        })
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12 sesiones',
          sessionsTotal: 12,
          sessionsUsed: 1,
          priceCents: 52800,
          owedCents: 26400,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('Bono 12 sesiones').should('be.visible')
        cy.contains('264,00 € owed').should('be.visible')
        cy.contains('264,00 € paid of 528,00 €').should('be.visible')
        cy.contains('paid in full').should('not.exist')
      })
    })
  })

  it('can be collected on, raising the invoice the bono never had', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cobro', lastName: 'Bono' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12 sesiones',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
          owedCents: 26400,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('264,00 € owed').should('be.visible')
        // There is no invoice to take the money against, so this button used
        // to do nothing at all. It now raises one for the outstanding amount
        // and opens the payment panel prefilled with it.
        // The bono's own button, not the account-level "Take payment" at the
        // top of the tab -- only this one carries the ellipsis.
        cy.contains('button', 'Take payment\u2026').click()
        cy.contains('button', 'Record payment').click()

        cy.contains('528,00 € paid in full').should('be.visible')
        cy.contains('264,00 € owed').should('not.exist')
      })
    })
  })
})
