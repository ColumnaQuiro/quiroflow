// The bono card used to print two euro figures under the same words.
//
// "11 of 12 left · 484,00 €" at the top, then "11/12 left · 528,00 €" three
// lines below -- the session count repeated, and two different amounts, each
// unlabelled. One is what the remaining sessions are worth, the other is what
// the bono cost, and nothing on screen said which was which. The person who
// asked me about it was reading it correctly; the card was the problem.
describe('The bono card’s figures', () => {
  it('says what each amount is, and states the session count once', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Vista', lastName: 'Bono' }).then((patient: any) => {
        // 12 sessions at €528, one taken, paid in full — the case on screen.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 52800, status: 'paid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 52800, method: 'card' })
          cy.task('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: patient.id,
            packageName: 'Bono 12 sesiones',
            sessionsTotal: 12,
            sessionsUsed: 1,
            priceCents: 52800,
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('Bono 12 sesiones').scrollIntoView().should('be.visible')
          // What is left, and what it is worth — 11 × €44.
          cy.contains('11 of 12 sessions left').scrollIntoView().should('be.visible')
          cy.contains('worth 484,00 €').scrollIntoView().should('be.visible')
          // What it cost, said as a price rather than a bare number.
          cy.contains('528,00 € paid in full').scrollIntoView().should('be.visible')
          // And the count is not printed a second time with a different
          // amount beside it.
          cy.contains('11/12 left').should('not.exist')
        })
      })
    })
  })

  it('shows what is still owed on a part-paid bono, against its price', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Parte', lastName: 'Pagada' }).then((patient: any) => {
        // €528 bono, €264 paid: half of it still owed.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 52800, status: 'unpaid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 26400, method: 'card' })
          cy.task('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: patient.id,
            packageName: 'Bono 12 sesiones',
            sessionsTotal: 12,
            sessionsUsed: 0,
            priceCents: 52800,
            invoiceId: inv.id,
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('12 of 12 sessions left').scrollIntoView().should('be.visible')
          cy.contains('264,00 € paid of 528,00 €').should('be.visible')
          cy.contains('paid in full').should('not.exist')
        })
      })
    })
  })
})
