// Spending credit is not the clinic earning money again.
//
// Money paid in on account writes a payment with the real method -- cash,
// card -- and a matching credit row. Spending that credit later writes a
// SECOND payment, method 'credit', against whatever it settled. Both are real
// rows and both are right; only one of them is income.
//
// Every income figure summed both. Adrian Oropeza handed over €115 in cash on
// 16 Sep 2026 and it was applied to his bono an hour later, so September read
// €230 for it -- and a payment method called "credit" appeared in the
// by-method chart beside Efectivo and Tarjeta, which is how it was spotted:
// the cash he paid with had turned into a method of its own.
//
// A write-off is the same mistake in the other direction -- a debt forgiven,
// counted as a debt collected.
describe('Credit spent is not counted as income', () => {
  function seedPatient(account: any, firstName: string) {
    return cy.task('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName,
      lastName: 'Credito',
      defaultPractitionerId: account.teamMemberId,
    })
  }

  it('counts the cash once, not the cash and the credit it became', () => {
    cy.seedStaffAccount().then((account) => {
      seedPatient(account, 'Adrian').then((patient: any) => {
        // The money arriving.
        cy.task('db:createPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 11500,
          method: 'cash',
          purpose: 'on_account',
        })
        // The same money, an hour later, going onto a bono.
        cy.task('db:createPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 11500,
          method: 'credit',
          purpose: 'bono',
        })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')

        cy.get('[data-test="income-total-paid"]').should('have.text', '115,00 €')
      })
    })
  })

  it('says where the credit went rather than dropping it silently', () => {
    // The fix is not "hide it". A figure that simply disappears from a report
    // is what let the double count stand for a week.
    cy.seedStaffAccount().then((account) => {
      seedPatient(account, 'Ana').then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11000, method: 'card', purpose: 'on_account' })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5500, method: 'credit', purpose: 'visit' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')

        cy.get('[data-test="income-total-paid"]').should('have.text', '110,00 €')
        cy.contains('p', 'settled from credit on account').should('be.visible').and('contain.text', '55,00 €')
      })
    })
  })

  it('does not count a written-off debt as money taken', () => {
    cy.seedStaffAccount().then((account) => {
      seedPatient(account, 'Baja').then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4000, method: 'cash' })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 6000, method: 'write_off' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')

        cy.get('[data-test="income-total-paid"]').should('have.text', '40,00 €')
      })
    })
  })

  // The end-of-day page is read against the drawer and the card terminal, so
  // it has the strongest claim to counting only what arrived -- and the
  // weakest tolerance for a row going missing without explanation.
  describe('on the day sheet', () => {
    it('leaves credit out of the takings but still shows the row', () => {
      cy.seedStaffAccount().then((account) => {
        seedPatient(account, 'Dia').then((patient: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, method: 'cash', purpose: 'on_account' })
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, method: 'credit', purpose: 'bono' })

          cy.login(account.email, account.password)
          cy.visit('/reports/daily-transactions')
          cy.contains('Net collected').should('be.visible')

          cy.get('[data-test="daily-net-collected"]').should('have.text', '115,00 €')
          cy.contains('Credit applied').should('be.visible')
          cy.contains('Not money in today').should('be.visible')
        })
      })
    })

    it('names the method instead of printing the stored key', () => {
      // Every row of the Method column rendered payments.method raw, so a day
      // with a credit or a write-off on it read "credit" and "write_off".
      cy.seedStaffAccount().then((account) => {
        seedPatient(account, 'Etiqueta').then((patient: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'credit', purpose: 'visit' })

          cy.login(account.email, account.password)
          cy.visit('/reports/daily-transactions')
          cy.contains('Net collected').should('be.visible')

          cy.contains('td', 'Credit on account').should('be.visible')
          cy.contains('td', 'credit').should('not.exist')
        })
      })
    })
  })
})
