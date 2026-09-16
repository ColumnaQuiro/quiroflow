// Money handed over "on account" is written down twice, on purpose: a payment
// row, because the money arrived and a factura has to say so, and an
// account_credits row, because it is still the patient's to direct somewhere.
// Two rows, one set of euros.
//
// The balance added both. Adrian Oropeza handed over EUR 115 and moved EUR 230
// ahead of himself; the pill by his name offered it all back to him. Anything
// reading those two rows has to pick one of them, and the credit ledger is the
// one that says what is left.
describe('Money taken on account', () => {
  it('counts once, not once as a payment and again as credit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ona', lastName: 'Onaccount' }).then((patient: any) => {
        // Exactly what Add credit writes for EUR 115 in cash.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, method: 'cash', purpose: 'on_account' })
        cy.task('db:createAccountCredit', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, reason: 'Cash on account' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('€115.00 available').should('be.visible')
        cy.contains('€230.00 available').should('not.exist')
      })
    })
  })

  it('does not pay down a bono just because it is linked to one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lin', lastName: 'Linked' }).then((patient: any) => {
        // A EUR 528 bono with nothing paid on it, twelve sessions untouched.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12 sesiones',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
          owedCents: 52800,
        }).then((purchase: any) => {
          // The EUR 115 of credit, attached to that bono by hand. It is still
          // credit: nothing has drawn it down, so it cannot also have bought
          // sessions. Spending it happens through Collect with method Credit,
          // which writes the negative credit row.
          cy.task('db:createPayment', {
            accountId: account.accountId,
            patientId: patient.id,
            packagePurchaseId: purchase.id,
            amountCents: 11500,
            method: 'cash',
            purpose: 'on_account',
          })
          cy.task('db:createAccountCredit', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, reason: 'Cash on account' })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}`)

          // The credit, and nothing from the bono: all 528 of it is still owed,
          // so none of those twelve sessions has been paid for.
          cy.contains('€115.00 available').should('be.visible')
        })
      })
    })
  })
})
