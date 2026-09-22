// A refund can name the payment it gives back.
//
// Refunds hung off the RECEIPT, which is the right answer only while a visit
// was settled in one go. A €50 receipt paid €30 cash + €20 card had a single
// refundable total of €50 and a free choice of method, so "€50 back to card"
// could be recorded against €20 that ever touched a card. The patient ends up
// square either way -- the ledger nets out -- but the Income report's "By
// payment method" split and the card reconciliation then both describe money
// that did not move that way.
//
// It also could not say what it corrected: with several payments behind the
// receipt there were several facturas and no single "the" one, so the
// rectificativa named no predecessor.
describe('Refunding one payment of a split', () => {
  it('caps at that payment, keeps its method, and corrects its factura', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sofia', lastName: 'Splitpay' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5000, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // Paid through the UI, not seeded: a factura per payment is what makes
        // "which document does this correct" a real question.
        cy.contains('50,00 €').should('exist')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').as('form')
        cy.get('@form').find('input[type="number"]').first().clear().type('30')
        cy.get('@form').find('select').eq(1).select('Cash')
        cy.get('@form').contains('button', 'Split into another method').click()
        cy.get('@form').find('input[type="number"]').eq(1).clear().type('20')
        cy.get('@form').find('select').eq(2).select('Card')
        cy.get('@form').contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one document per payment').to.have.length(2)
        })

        // The card half only. The cash half sits in the same ledger and must
        // be left alone by all of this.
        cy.contains('tr', 'Payment — card').click()
        cy.contains('button', 'Refund…').click()

        // Capped at the €20 that arrived on the card, NOT the €50 the receipt
        // was paid -- which is the whole point.
        cy.contains('up to 20,00 €').should('exist')
        // And pre-set to the way the money came in, rather than the account
        // default (cash), so the ordinary case needs no correcting.
        cy.get('.fixed').find('select').should('have.value', 'card')

        // Partial: €5 of the €20.
        cy.get('.fixed').find('input[type="number"]').clear().type('5')
        cy.get('.fixed').contains('button', 'Refund').click()
        cy.contains('Reason (optional)').should('not.exist')
        cy.contains('li', 'R-').should('be.visible')

        cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
          const out = rows.filter((r: any) => r.amount_cents < 0)
          expect(out, 'one refund payment').to.have.length(1)
          expect(out[0].amount_cents, 'five euros of the twenty').to.eq(-500)
          // Back out the way it came in.
          expect(out[0].method).to.eq('card')
          // The cash half is untouched.
          expect(rows.filter((r: any) => r.amount_cents === 3000 && r.method === 'cash')).to.have.length(1)
        })

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          const rectifying = rows.find((r: any) => r.kind === 'rectificativa')
          const cardFactura = rows.find((r: any) => r.amount_cents === 2000)

          expect(rectifying, 'a rectificativa was issued').to.not.be.undefined
          expect(rectifying.number).to.match(/^R-\d{4}-\d{4}$/)
          expect(rectifying.amount_cents, 'only what went back').to.eq(-500)
          // It names the CARD document specifically. Refunding the receipt as
          // a whole could not: two facturas behind it, no single predecessor.
          expect(rectifying.rectifies_factura_id, 'the card half').to.eq(cardFactura.id)
          expect(rectifying.description).to.contain(cardFactura.number)
        })
      })
    })
  })

  it('will not give back more than the payment brought in', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cora', lastName: 'Capped' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5000, status: 'unpaid' }).then((invoice: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, invoiceId: invoice.id, amountCents: 3000, method: 'cash' })
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, invoiceId: invoice.id, amountCents: 2000, method: 'card' })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('tr', 'Payment — card').click()
          cy.contains('button', 'Refund…').click()

          // Asking for the receipt's full €50 against a €20 payment: the
          // submit stays disabled rather than quietly writing it.
          cy.get('.fixed').find('input[type="number"]').clear().type('50')
          cy.get('.fixed').contains('button', 'Refund').should('be.disabled')

          // €20 exactly is allowed.
          cy.get('.fixed').find('input[type="number"]').clear().type('20')
          cy.get('.fixed').contains('button', 'Refund').should('not.be.disabled').click()
          cy.contains('Reason (optional)').should('not.exist')

          cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
            const out = rows.filter((r: any) => r.amount_cents < 0)
            expect(out, 'exactly one refund, for the card payment').to.have.length(1)
            expect(out[0].amount_cents).to.eq(-2000)
          })

          // Fully refunded, so it offers nothing further -- and the receipt's
          // own remaining room drops with it, which is what stops the same
          // €20 going back a second time by the other route.
          cy.reload()
          cy.contains('tr', 'Payment — card').click()
          cy.get('body').then(($b) => {
            expect($b.text(), 'no refund left on this payment').to.not.contain('Refund… 20,00 €')
          })
          cy.contains('tr', 'Receipt').click()
          cy.contains('button', 'Refund…').click()
          // Only the cash half remains.
          cy.contains('up to 30,00 €').should('exist')
        })
      })
    })
  })
})
