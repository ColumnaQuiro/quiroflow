// A payment taken as cash that was really card is corrected in place.
//
// The only fix used to be removing the payment and taking it again: the
// receipt reopened in between, the money was re-dated to the day of the
// correction, and a factura issued for it was left flagged as matching no
// payment. Changing the method touches none of that, and says who did it.
describe('Changing a payment method', () => {
  it('moves a cash payment to card without reopening the receipt, and logs it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mateo', lastName: 'Metodo' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' }).then((invoice: any) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          // Taken as cash, which issues a factura for it.
          cy.contains('INV-').should('exist')
          cy.contains('button', 'Take payment').click()
          cy.contains('button', 'Record payment').parents('form').as('form')
          cy.get('@form').contains('button', 'Record payment').click()
          cy.contains('button', 'Recording…').should('not.exist')

          cy.contains('tr', 'Payment — cash').click()
          cy.get('[data-cy=payment-change-method]').click()
          cy.get('[data-cy=payment-method-modal]').within(() => {
            // Saving the method it already has is not a change.
            cy.get('[data-cy=payment-method-save]').should('be.disabled')
            cy.get('[data-cy=payment-method-select]').select('card')
            cy.get('[data-cy=payment-method-save]').click()
          })

          cy.contains('tr', 'Payment — card').should('exist')
          cy.contains('tr', 'Payment — cash').should('not.exist')

          cy.task('db:paymentsFor', { patientId: patient.id }).then((payments: any) => {
            expect(payments, 'still one payment, not a removal and a new one').to.have.length(1)
            expect(payments[0].method).to.eq('card')
            expect(payments[0].invoice_id).to.eq(invoice.id)
          })
          cy.task('db:invoiceById', { invoiceId: invoice.id }).its('status').should('eq', 'paid')
          cy.task('db:facturasFor', { patientId: patient.id }).then((facturas: any) => {
            expect(facturas, 'the factura still documents the payment').to.have.length(1)
            expect(facturas[0].payment_id).to.not.eq(null)

            cy.task('db:auditLogFor', { entityId: facturas[0].payment_id }).then((log: any) => {
              expect(log).to.have.length(1)
              expect(log[0].entity_type).to.eq('payment')
              expect(log[0].summary).to.eq('Method changed from cash to card')
              expect(log[0].team_member_id, 'and who changed it').to.not.eq(null)
            })

            // Account credit is not money: the database refuses, whatever the
            // screen offers.
            cy.task('db:writeAsStaff', { email: account.email, password: account.password, op: 'setPaymentMethod', paymentId: facturas[0].payment_id, method: 'credit' }).then(
              (result: any) => {
                expect(result.error).to.contain('not money')
              },
            )
          })
        })
      })
    })
  })

  it('offers no change on a payment charged through Stripe', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Estela', lastName: 'Stripe' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'paid' }).then((invoice: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: invoice.id, amountCents: 4400, method: 'card', stripePaymentIntentId: 'pi_test_change_method' })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)
          cy.contains('tr', 'Payment — card').click()
          cy.contains('Automatic (card on file)').should('be.visible')
          cy.get('[data-cy=payment-change-method]').should('not.exist')
        })
      })
    })
  })
})
