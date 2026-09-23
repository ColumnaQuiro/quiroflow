// "Owing" listed patients who had paid in full.
//
// patient_live_balances reached payments through an INNER join to invoices, so
// a payment with no invoice_id counted for nothing and the patient was left
// carrying the whole invoiced total as debt. Having no invoice_id is the
// ordinary case, not an edge one: imported PracticeHub payments arrive
// unallocated, a bono sale raises no invoice at all (20260914150556 removed
// it, because the bono's charge plus each visit's charge billed the patient
// twice), and money on account has none until it is spent.
//
// On the live account that was 944 of 1,579 patients and 308,380 EUR of debt
// that did not exist -- and never the other way round, because the view could
// only ever under-count what was paid.
//
// The seeding here is the shape that broke it: a payment that names its
// patient and no invoice. usePatientFinancialSummary has always read payments
// this way; this is the view catching up, so the list and the Billing tab
// finally answer the same question.
describe('The Owing filter', () => {
  it('does not list a patient whose payment settled no particular invoice', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }

      // Paid in full, but the money settles no invoice -- the imported and the
      // bono shape. Balance is zero and this patient owes nothing.
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Aurora', lastName: 'Cendra' }).then((settled) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: settled.id, totalCents: 5000, status: 'unpaid' })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: settled.id, amountCents: 5000, method: 'cash' })

        // A real debtor, so the filter is shown to be working rather than
        // merely empty -- the failure this guards against would hide behind an
        // assertion that only ever said "not.exist".
        cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Nestor', lastName: 'Quilez' }).then((debtor) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: debtor.id, totalCents: 5000, status: 'unpaid' })

          cy.login(account.email, account.password)
          cy.visit('/patients')

          cy.contains('Aurora Cendra').should('be.visible')
          cy.contains('Nestor Quilez').should('be.visible')

          cy.get('select[aria-label="Balance"]').select('owing')

          cy.contains('Nestor Quilez').should('be.visible')
          cy.contains('Aurora Cendra').should('not.exist')
        })
      })
    })
  })
})
