// A payment recorded with the wrong amount is corrected with a rectificativa.
//
// The factura issued for it is a fiscal record and is never edited: the
// difference goes on a second document in the R series that names it, and
// the payment takes its right amount in the same transaction. The amount of a
// payment with a factura cannot be changed any other way, so the payment and
// what the series says about it cannot drift apart.
describe('Correcting a payment amount', () => {
  it('corrects 44 to 40 with a rectificativa for the difference, and refuses a direct edit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Irene', lastName: 'Importe' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' }).then((invoice: any) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          // Taken as cash, which issues a factura for it.
          cy.contains('INV-').should('exist')
          cy.contains('button', 'Take payment').click()
          cy.contains('button', 'Record payment').parents('form').as('form')
          cy.get('@form').contains('button', 'Record payment').click()
          cy.contains('button', 'Recording…').should('not.exist')

          cy.contains('tr', 'Payment — Cash').click()
          cy.get('[data-cy=payment-correct-amount]').click()
          cy.get('[data-cy=payment-amount-modal]').within(() => {
            // The same amount is not a correction, and neither is one with no reason.
            cy.get('[data-cy=payment-amount-save]').should('be.disabled')
            cy.get('[data-cy=payment-amount-input]').clear().type('40')
            cy.get('[data-cy=payment-amount-save]').should('be.disabled')
            cy.get('[data-cy=payment-amount-reason]').type('typed 44 instead of 40')
            cy.get('[data-cy=payment-amount-save]').click()
          })
          cy.contains('rectifying factura R-').should('be.visible')

          cy.task('db:paymentsFor', { patientId: patient.id }).then((payments: any) => {
            expect(payments, 'the same payment, corrected in place').to.have.length(1)
            expect(payments[0].amount_cents).to.eq(4000)
          })
          // 40 of 44 came in: the receipt is open again for the other 4.
          cy.task('db:invoiceById', { invoiceId: invoice.id }).its('status').should('eq', 'unpaid')

          cy.task('db:facturasFor', { patientId: patient.id }).then((facturas: any) => {
            expect(facturas).to.have.length(2)
            const [original, rectificativa] = facturas
            expect(original.amount_cents, 'the original factura is untouched').to.eq(4400)
            expect(original.payment_id).to.not.eq(null)
            expect(rectificativa.kind).to.eq('rectificativa')
            expect(rectificativa.number).to.match(/^R-/)
            expect(rectificativa.amount_cents, 'the difference, negative').to.eq(-400)
            expect(rectificativa.rectifies_factura_id).to.eq(original.id)
            expect(rectificativa.description).to.contain(`Rectificación de ${original.number}`)
            expect(rectificativa.description).to.contain('typed 44 instead of 40')

            // Straight through the REST API, without the rectificativa: refused.
            cy.task('db:writeAsStaff', { email: account.email, password: account.password, op: 'setPaymentAmount', paymentId: original.payment_id, amountCents: 100 }).then(
              (result: any) => {
                expect(result.error).to.contain('correct_payment_amount')
              },
            )
          })
          cy.task('db:paymentsFor', { patientId: patient.id }).its('0.amount_cents').should('eq', 4000)
        })
      })
    })
  })

  it('offers no correction on a payment charged through Stripe', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sara', lastName: 'Stripe' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'paid' }).then((invoice: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: invoice.id, amountCents: 4400, method: 'card', stripePaymentIntentId: `pi_test_correct_amount_${Date.now()}` })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)
          cy.contains('tr', 'Payment — Card').click()
          cy.contains('Automatic (card on file)').should('be.visible')
          cy.get('[data-cy=payment-correct-amount]').should('not.exist')
        })
      })
    })
  })
})
