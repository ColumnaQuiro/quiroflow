// What the patient is handed for a visit is a RECIBO, not a factura.
//
// Fiscally the invoice follows the payment: that is the facturas series
// (F-2026-0001), issued when money actually changes hands. The INV- document
// records what was done and what it cost. Calling that one an invoice too put
// two numbered series in front of the patient for the same money -- and the
// PDF said "Invoice INV-0001" on its face.
describe('The document for a visit', () => {
  it('is called a receipt everywhere the charge is worked with', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rita', lastName: 'Recibo' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' }).then((inv: any) => {
          cy.login(account.email, account.password)

          // The ledger row, and the panel that takes money against it.
          cy.visit(`/patients/${patient.id}?tab=billing`)
          // The ledger names the charge a Receipt, while the Facturas card
          // right above it keeps its own name -- the whole point is that the
          // two documents are no longer called the same thing.
          cy.contains('Receipt').should('be.visible')
          cy.contains('Facturas').should('be.visible')
          cy.contains('button', 'Take payment').click()
          cy.contains('label', 'Receipt').should('be.visible')

          // The document's own page.
          cy.visit(`/billing/${inv.id}`)
          cy.contains('button', 'Void receipt').should('be.visible')
          cy.contains('button', 'Void invoice').should('not.exist')

          // And the list it is created from.
          cy.visit('/billing')
          cy.contains('Quick receipt').should('be.visible')
        })
      })
    })
  })

  it('downloads as a PDF that is not the factura series', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pedro', lastName: 'Pdf' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' }).then((inv: any) => {
          cy.login(account.email, account.password)
          cy.request({ url: `/api/invoices/${inv.id}/pdf`, encoding: 'binary' }).then((res) => {
            expect(res.status).to.eq(200)
            expect(res.headers['content-type']).to.contain('application/pdf')
            expect(res.body.slice(0, 5)).to.eq('%PDF-')
          })
        })
      })
    })
  })
})
