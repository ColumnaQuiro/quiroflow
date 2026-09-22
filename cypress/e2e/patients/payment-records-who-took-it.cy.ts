// Money should say who handled it.
//
// `payments` and `facturas` were the last two staff-written tables with no
// author on them, and audit_logs has only ever covered patients and
// appointments. So "who took this €44?" could only be answered by finding
// whoever touched the appointment around the same minute and assuming it was
// also them -- an inference, not a record, and a thin trail for a numbered
// fiscal document.
//
// created_by is stamped by trigger rather than at the five payment insert
// sites, so what matters here is that an ordinary payment taken through the
// UI carries the right person without any call site having asked for it.
describe('A payment records who took it', () => {
  it('stamps the staff member on both the payment and its factura', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paula', lastName: 'Paycash' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // openTakePayment() snapshots the invoice list synchronously at
        // click-time, so wait for the invoice itself to render -- waiting on
        // the amount instead matches the outstanding total, which is on
        // screen before the invoice list has loaded, and the picker then
        // opens with nothing selected and Record payment disabled.
        cy.contains('INV-').should('exist')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').as('form')
        // The first row already defaults to the full balance in cash.
        cy.get('@form').contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')

        // The ledger names the person, resolved through the embedded
        // team_members row rather than any client-side list.
        cy.contains('tr', 'Payment — cash').click()
        cy.contains('Recorded by').should('be.visible')
        cy.contains('Recorded by').parent().should('contain.text', 'Test Owner')

        // And the fiscal document carries it too -- the trigger is on both
        // tables, and useFacturas() never mentions created_by.
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one factura for the one payment').to.have.length(1)
          expect(rows[0].created_by, 'the factura knows who issued it').to.not.eq(null)
        })
      })
    })
  })
})
