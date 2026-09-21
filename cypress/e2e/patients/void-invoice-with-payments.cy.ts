// Voiding an invoice only flips its status -- it leaves any payments in
// place -- while every total that reads a patient's finances drops a void
// invoice's debit and still counts its payments. So voiding a paid invoice
// silently inflates that patient's balance by the amount paid, forever. One
// such row (a duplicate from the PracticeHub import) had a real patient
// reading 528 EUR of credit against a real 264 EUR for a month.
//
// Lives under patients/ rather than a new billing/ folder on purpose: the CI
// shards are folder globs (.github/workflows/e2e.yml), so a spec in a folder
// no glob names would never run.
describe('Voiding an invoice that has payments', () => {
  it('is blocked once a payment is recorded, and allowed while there are none', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Vera',
        lastName: 'Voidable',
      }).then((patient) => {
        cy.task<{ id: string }>('db:createInvoice', {
          accountId: account.accountId,
          patientId: patient.id,
          totalCents: 5000,
        }).then((invoice) => {
          cy.login(account.email, account.password)
          cy.visit(`/billing/${invoice.id}`)

          // Nothing paid yet: voiding is the right action and stays available.
          cy.contains('No payments recorded.').should('be.visible')
          cy.contains('button', 'Void receipt').should('not.be.disabled')

          cy.contains('button', 'Record payment').parents('form').as('paymentForm')
          cy.get('@paymentForm').find('input[type="number"]').clear().type('50')
          cy.get('@paymentForm').find('select').select('Cash')
          cy.get('@paymentForm').contains('button', 'Record payment').click()

          cy.contains('li', 'cash').should('contain', '50,00 €')

          // Money is on the invoice now -- the way out is a refund, not a void.
          cy.contains('button', 'Void receipt')
            .should('be.disabled')
            .should('have.attr', 'title')
            .and('contain', 'Refund or remove the payments')
        })
      })
    })
  })
})
