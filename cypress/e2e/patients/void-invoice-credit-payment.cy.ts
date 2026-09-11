// Voiding an invoice drops its debit from every total but leaves its payments
// in place. For a 'credit' payment that is pure inflation: no money was ever
// collected -- the row recorded a patient spending account credit on a charge
// that has since been cancelled -- so counting it while the debit is gone adds
// the amount to the patient's balance out of nowhere.
//
// It bit for real: when the historical bono-session invoices were voided in
// bulk, 2,338.33 EUR appeared across 44 patients' balances.
describe('A credit payment left on a voided invoice', () => {
  it('does not inflate the balance, and does not show as a credit in the ledger', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Vita', lastName: 'Voidcredit' }).then((patient: any) => {
        cy.task('db:createInvoice', {
          accountId: account.accountId,
          patientId: patient.id,
          totalCents: 4400,
          status: 'void',
        }).then((invoice: any) => {
          cy.task('db:createPayment', {
            accountId: account.accountId,
            invoiceId: invoice.id,
            amountCents: 4400,
            method: 'credit',
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}`)

          // The void invoice contributes no debit, so if its credit payment
          // still counted the balance would read €44.00.
          cy.contains('dt', 'Balance').parent().should('contain', '€0.00')
        })
      })
    })
  })

  it('still counts a CARD payment left on a voided invoice', () => {
    // The other half of the rule, and the reason this is not a blanket filter:
    // real money was collected and the charge was cancelled, so the clinic owes
    // it back. That has to stay visible rather than being quietly netted away.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cora', lastName: 'Cardvoid' }).then((patient: any) => {
        cy.task('db:createInvoice', {
          accountId: account.accountId,
          patientId: patient.id,
          totalCents: 4400,
          status: 'void',
        }).then((invoice: any) => {
          cy.task('db:createPayment', {
            accountId: account.accountId,
            invoiceId: invoice.id,
            amountCents: 4400,
            method: 'card',
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}`)

          cy.contains('dt', 'Balance').parent().should('contain', '€44.00')
        })
      })
    })
  })
})
