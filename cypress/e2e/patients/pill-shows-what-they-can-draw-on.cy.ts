// The pill by the patient's name is the front desk's one-glance answer to
// "has this person got anything left, or do I charge them?".
//
// It used to show the balance and label it "credit", which is two errors at
// once. The balance is arithmetic over every charge and payment a patient has
// ever had, so it carries the whole imported PracticeHub history -- for 139 of
// the 217 patients showing a positive one it disagreed with what they could
// actually use. And bono money is not credit: it is already committed to the
// sessions it bought.
//
// Carolina Cañamas read "€281.00 credit" next to an Available of €120.
describe('The balance pill', () => {
  it('shows what the patient can draw on, not their balance', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Val', lastName: 'Vale' }).then((patient: any) => {
        // Deliberately pulled apart: 3 unused sessions at €40 is €120 to draw
        // on, while paid-minus-invoiced comes to €200. The old pill showed the
        // €200 and called it credit.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono mantenimiento',
          sessionsTotal: 12,
          sessionsUsed: 9,
          priceCents: 48000,
          owedCents: 0,
        })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 30000, method: 'card' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 10000, status: 'paid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('€120.00 available').should('be.visible')
        // Never the word "credit": bono money is committed to the sessions it
        // bought, and loose credit is its own ledger.
        cy.contains('credit').should('not.exist')
        // The Balance row below still reads €200.00, and should -- it is
        // labelled Balance and it is the honest arithmetic. What must not
        // happen is that number appearing in the pill as though it were
        // spendable.
        cy.contains('€200.00 available').should('not.exist')
      })
    })
  })

  it('falls back to what is owed when there is nothing to draw on', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Deb', lastName: 'Debtor' }).then((patient: any) => {
        // No bono, no credit, one unpaid charge. Owing money is not the
        // absence of available money, so this side still reads the balance.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('€44.00 due').should('be.visible')
      })
    })
  })
})
