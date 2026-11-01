// Billing (pages/billing/index.vue): with hundreds of unpaid receipts it had
// no search, one order and no way to act on several at once. Now a receipt is
// found by patient or number, the list sorts by amount, and unpaid receipts
// can be ticked to send their patients a WhatsApp -- leaving out, and
// counting, whoever cannot be messaged.

describe('Billing: search, sort and remind', () => {
  it('finds, orders and reminds unpaid receipts', () => {
    cy.seedStaffAccount().then((account) => {
      const owes = (first: string, number: string, cents: number, phone?: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Debe', ...(phone ? { phone } : {}) }).then((p) =>
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: p.id, invoiceNumber: number, totalCents: cents, status: 'unpaid' }),
        )
      owes('Ana', 'R-0001', 3000, '612000001')
      owes('Bruno', 'R-0002', 9000, '612000002')
      owes('Clara', 'R-0003', 5000)

      cy.login(account.email, account.password)
      cy.visit('/billing')
      cy.get('[data-cy=billing-row]').should('have.length', 3)

      cy.get('[data-cy=billing-sort]').select('largest')
      cy.get('[data-cy=billing-row]').first().should('contain', 'Bruno Debe')
      cy.get('[data-cy=billing-row]').last().should('contain', 'Ana Debe')

      // By number, then by name; the chips count what the search leaves.
      cy.get('[data-cy=billing-search]').type('R-0003')
      cy.get('[data-cy=billing-row]').should('have.length', 1).and('contain', 'Clara Debe')
      cy.contains('button', 'Unpaid').should('contain', '1')
      cy.get('[data-cy=billing-search]').clear().type('ana')
      cy.get('[data-cy=billing-row]').should('have.length', 1).and('contain', 'Ana Debe')
      cy.get('[data-cy=billing-search]').clear().type('nadie')
      cy.get('[data-cy=billing-empty]').should('contain', 'No receipts match this search.')
      cy.get('[data-cy=billing-search]').clear()
      cy.get('[data-cy=billing-row]').should('have.length', 3)

      // Clara has no phone: left out of the send, and said so.
      cy.get('[data-cy=billing-select-page]').check()
      cy.get('[data-cy=billing-select-bar]').should('contain', '3 selected')
      cy.get('[data-cy=billing-remind]').click()
      cy.get('[data-cy=billing-remind-skipped]').should('contain', '1 patient is left out')
      cy.contains('[role=dialog] h3', 'Send WhatsApp to 2 patients').should('be.visible')
    })
  })
})
