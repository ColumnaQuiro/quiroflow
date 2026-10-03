// Paying for a bono or a membership out of account credit writes two rows: the
// payment (method 'credit') and the negative account_credits row that draws
// the credit down. Both sale paths wrote the second whatever happened to the
// first -- so a refused payment still took the credit off the patient, for a
// bono or membership with nothing paid towards it. Adding credit and applying
// it to an invoice were fixed the same way before; these two were missed.
describe('A credit payment the database refuses', () => {
  beforeEach(() => {
    cy.intercept('POST', '**/rest/v1/payments*', {
      statusCode: 403,
      body: { code: '42501', message: 'new row violates row-level security policy for table "payments"' },
    }).as('payment')
  })

  it('draws no credit for a bono', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Credi', lastName: 'Tobono' }).then((patient) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })
        // Money on account, settling no charge: all of it spendable.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 10000, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('select', 'Sell a package').should('exist').select('Bono 12 (12, 528,00 €)')
        cy.get('input[type="number"]').last().clear().type('100')
        cy.contains('label', 'Method').parent().find('select').select('credit')
        cy.contains('button', /^Sell$/).click()
        cy.wait('@payment')

        cy.contains('The payment could not be recorded').should('be.visible')
        cy.task<any[]>('db:creditsFor', { patientId: patient.id }).then((rows) => {
          expect(rows, 'no credit drawn down').to.have.length(0)
        })
      })
    })
  })

  it('draws no credit, and leaves no paid receipt, for a membership', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Credi', lastName: 'Tomember' }).then((patient) => {
        cy.task('db:createMembershipTemplate', { accountId: account.accountId, name: 'Plan Mensual', priceCents: 5000 })
        // Money on account, settling no charge: all of it spendable.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 10000, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('select', 'Activate a membership').should('exist').select(1)
        cy.contains('select', 'Activate a membership').closest('form').contains('label', 'Method').parent().find('select').select('credit')
        cy.contains('button', /^Activate$/).click()
        cy.wait('@payment')

        cy.contains('The payment could not be recorded').should('be.visible')
        cy.task<any[]>('db:creditsFor', { patientId: patient.id }).then((rows) => {
          expect(rows, 'no credit drawn down').to.have.length(0)
        })
        cy.task<any[]>('db:invoicesFor', { patientId: patient.id }).then((rows) => {
          expect(rows, 'no receipt saying it was paid').to.have.length(0)
        })
      })
    })
  })
})
