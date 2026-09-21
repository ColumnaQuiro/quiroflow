// Money handed over "on account" is written down twice, on purpose: a payment
// row, because the money arrived and a factura has to say so, and an
// account_credits row, because it is still the patient's to direct somewhere.
// Two rows, one set of euros.
//
// The balance added both. Adrian Oropeza handed over EUR 115 and moved EUR 230
// ahead of himself; the pill by his name offered it all back to him. The
// credit row names its payment now, and a row that only restates a payment is
// not counted again.
describe('Money taken on account', () => {
  it('counts once, not once as a payment and again as credit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ona', lastName: 'Onaccount' }).then((patient: any) => {
        // Exactly what Add credit writes for EUR 115 in cash.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, method: 'cash', purpose: 'on_account' }).then((payment: any) => {
          cy.task('db:createAccountCredit', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, reason: 'Cash on account', paymentId: payment.id })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}`)

          cy.contains('115,00 € available').should('be.visible')
          cy.contains('230,00 € available').should('not.exist')
        })
      })
    })
  })

  it('goes onto the bono when it is linked there, and leaves the credit behind', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lin', lastName: 'Linked' }).then((patient: any) => {
        // The front desk's actual workflow: take the cash, then put it on the
        // bono. A EUR 528 bono with nothing paid on it, and EUR 115 sitting on
        // the account.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12 sesiones',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
          owedCents: 52800,
        })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, method: 'cash', purpose: 'on_account' }).then((payment: any) => {
          cy.task('db:createAccountCredit', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, reason: 'Cash on account', paymentId: payment.id })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          // Before: the whole EUR 528 owed on the bono.
          cy.contains('528,00 €').should('be.visible')
          cy.contains('button', 'Link payment').click()
          // Picked by the option's own text rather than by position: the
          // Billing tab has several selects (sell a package, sell a
          // membership, take payment) and which one comes last depends on
          // what this patient happens to have.
          cy.contains('option', '115,00 €').then(($option) => {
            cy.wrap($option).parent('select').select(String($option.val()))
          })
          cy.contains('button', /^Link$/).click()

          // After: the bono is EUR 115 better off and the credit has been
          // drawn down to pay for it. The same euros in one place, not both --
          // which is what linking alone used to leave behind.
          cy.contains('413,00 €').should('be.visible')
          cy.contains('Applied to Bono 12 sesiones').should('exist')
          // Twelve sessions still worth EUR 528, EUR 413 of them not paid for,
          // so EUR 115 is what the patient can draw on. Not 230.
          cy.contains('115,00 € available').should('be.visible')
          cy.contains('230,00 € available').should('not.exist')
        })
      })
    })
  })
})
