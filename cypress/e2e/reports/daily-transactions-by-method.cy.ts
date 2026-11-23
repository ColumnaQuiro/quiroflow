// Cash-up is done one method at a time -- the cash against the drawer, the
// cards against the terminal -- and the day sheet listed everything together,
// so reception counted the cash rows by eye. The method chips (and the tiles)
// narrow the table to one method, with its own count and total; the day's
// tiles keep the whole day.
describe('The day sheet narrows to one payment method', () => {
  it('lists only the method picked, with its total, and back to all', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Carmen', lastName: 'Efectivo' }).then((cash: any) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Tomás', lastName: 'Tarjeta' }).then((card: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: cash.id, amountCents: 4500, method: 'cash', purpose: 'visit' })
          cy.task('db:createPayment', { accountId: account.accountId, patientId: cash.id, amountCents: 3000, method: 'cash', purpose: 'visit' })
          cy.task('db:createPayment', { accountId: account.accountId, patientId: card.id, amountCents: 24000, method: 'card', purpose: 'bono' })

          cy.login(account.email, account.password)
          cy.visit('/reports/daily-transactions')
          cy.get('[data-test=daily-net-collected]').should('have.text', '315,00 €')
          cy.contains('td', 'Carmen Efectivo').should('be.visible')
          cy.contains('td', 'Tomás Tarjeta').should('be.visible')

          cy.get('[data-cy=daily-method-cash]').click()
          cy.contains('td', 'Tomás Tarjeta').should('not.exist')
          cy.get('tbody tr').should('have.length', 2)
          cy.get('[data-test=daily-method-total]').should('contain.text', '2 payments').and('contain.text', '75,00 €')
          // The day's figure is the day's, whatever the table shows.
          cy.get('[data-test=daily-net-collected]').should('have.text', '315,00 €')

          // The tile is the same switch.
          cy.get('[data-cy=daily-method-tile-card]').click()
          cy.contains('td', 'Carmen Efectivo').should('not.exist')
          cy.contains('td', 'Tomás Tarjeta').should('be.visible')
          cy.get('[data-cy=daily-method-tile-card]').should('have.attr', 'aria-pressed', 'true')

          cy.get('[data-cy=daily-method-all]').click()
          cy.get('tbody tr').should('have.length', 3)
          cy.get('[data-test=daily-method-total]').should('not.exist')
        })
      })
    })
  })
})
