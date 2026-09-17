// A refund has to issue the document that says the money went back.
//
// createRefund() wrote the REF- invoice, its line item and the negative
// payment, and issued no fiscal document at all -- the call was never wired
// up. So the factura saying the money came in kept standing on its own.
//
// Every refund the clinic had ever made was in that state: all five
// post-dated facturas going live, and not one had a rectifying document.
// 206 EUR of the 2026 series documented money returned the same day.
describe('Refunding a paid visit', () => {
  it('issues a rectificativa against the factura it corrects', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rita', lastName: 'Rectifica' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4300, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // Pay it through the UI rather than seeding the payment, so the
        // original factura is issued by the same path a real visit takes --
        // there has to be a document to correct before correcting it means
        // anything.
        cy.contains('INV-').should('be.visible')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').as('form')
        cy.get('@form').contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'the visit was documented').to.have.length(1)
          expect(rows[0].number).to.match(/^F-\d{4}-\d{4}$/)
        })

        // Now give it back. The row actions live in the ledger row's detail
        // panel, so the receipt has to be opened before Refund… exists.
        cy.contains('tr', 'Receipt').click()
        cy.contains('button', 'Refund…').click()
        cy.contains('Reason (optional)').parent().find('input').type('sesión ya cubierta por el bono')
        cy.get('.fixed').contains('button', 'Refund').click()
        // The modal closes the instant Refund is clicked -- submitRefund
        // clears it synchronously and the writes carry on behind it. Waiting
        // on the document appearing in the list is waiting on the work, and
        // it is also the thing a person would look for.
        cy.contains('Reason (optional)').should('not.exist')
        cy.contains('li', 'R-').should('be.visible')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'the sale and its correction').to.have.length(2)
          const original = rows.find((r: any) => r.kind !== 'rectificativa')
          const rectifying = rows.find((r: any) => r.kind === 'rectificativa')

          expect(rectifying, 'a rectificativa was issued').to.not.be.undefined
          // Its own series, so the F- run stays a record of money in.
          expect(rectifying.number, 'R- series').to.match(/^R-\d{4}-\d{4}$/)
          // Negative: the sign is what makes it a correction rather than a
          // second sale.
          expect(rectifying.amount_cents, 'money going back').to.eq(-4300)
          // And it names what it corrects, on the document and in the data.
          expect(rectifying.description).to.contain(original.number)
          expect(rectifying.rectifies_factura_id, 'linked to the original').to.not.be.null
          expect(rectifying.description).to.contain('sesión ya cubierta por el bono')
        })
      })
    })
  })
})
