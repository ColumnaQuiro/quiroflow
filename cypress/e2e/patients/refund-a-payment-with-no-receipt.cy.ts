// A payment with no receipt behind it can be refunded.
//
// Every imported PracticeHub payment is one -- PracticeHub links a payment to
// nothing -- and the Refund action simply was not offered on them. Reception
// refunded Viviane Vieira Tostes 39 EUR of a 204 EUR card payment anyway and
// could only leave a 0 EUR note saying so, so the Income report never saw the
// money go back. See utils/paymentRefund.ts.
describe('Refunding a payment with no receipt', () => {
  it('corrects the charge when the patient had nothing left on account', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Viv', lastName: 'Noreceipt' }).then((patient: any) => {
        // What the import leaves: the charge settled as a whole, the money
        // allocated to nothing. The patient is square.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, invoiceNumber: 'PHI-1', totalCents: 20400, status: 'paid' })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 20400, method: 'card' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('tr', 'Payment — card').click()
        cy.contains('button', 'Refund…').click()
        cy.contains('up to 204,00 €').should('exist')
        cy.get('.fixed').find('select').should('have.value', 'card')
        cy.get('.fixed').find('input[type="number"]').clear().type('39')
        cy.get('.fixed').contains('button', 'Refund').click()
        cy.contains('Reason (optional)').should('not.exist')

        // Named by the payment it gives back, not as a "deleted receipt".
        cy.contains('tr', 'REF-').should('contain', 'Refund — payment of')

        cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
          const out = rows.filter((r: any) => r.amount_cents < 0)
          expect(out, 'the money going back, which the Income report reads').to.have.length(1)
          expect(out[0].amount_cents).to.eq(-3900)
          expect(out[0].method).to.eq('card')
        })
        cy.task('db:invoicesFor', { patientId: patient.id }).then((rows: any) => {
          const refund = rows.find((r: any) => r.total_cents < 0)
          // The whole 39 corrects the charge, so the balance stays square.
          expect(refund.total_cents, 'refund invoice carries the full amount').to.eq(-3900)
        })

        // And the same 39 cannot go back a second time. Reloaded, so the row
        // opened above starts closed and the click opens it rather than
        // folding it away.
        cy.reload()
        cy.contains('tr', 'Payment — card').click()
        cy.contains('button', 'Refund…').click()
        cy.contains('up to 165,00 €').should('exist')
      })
    })
  })

  it('takes money still on account off the balance, so it is not offered again', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sobra', lastName: 'Encuenta' }).then((patient: any) => {
        // 100 paid and nothing charged: all of it is still the patient's.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 10000, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('tr', 'Payment — cash').click()
        cy.contains('button', 'Refund…').click()
        cy.contains('up to 100,00 €').should('exist')
        cy.get('.fixed').find('input[type="number"]').clear().type('40')
        cy.get('.fixed').contains('button', 'Refund').click()
        cy.contains('Reason (optional)').should('not.exist')
        cy.contains('tr', 'REF-').should('exist')

        cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows.filter((r: any) => r.amount_cents === -4000), 'all 40 went out').to.have.length(1)
        })
        cy.task('db:invoicesFor', { patientId: patient.id }).then((rows: any) => {
          // None of it corrected a charge -- there was none -- so the refund
          // invoice carries nothing and the balance drops by the full 40.
          expect(rows, 'just the refund invoice').to.have.length(1)
          expect(rows[0].total_cents).to.eq(0)
        })

        // 60 left on the payment, counted from what was paid out rather than
        // from the refund invoice's total.
        cy.reload()
        cy.contains('tr', 'Payment — cash').click()
        cy.contains('button', 'Refund…').click()
        cy.contains('up to 60,00 €').should('exist')
      })
    })
  })

  it('still offers nothing on a top-up, whose credit would outlive the refund', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Top', lastName: 'Up' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'cash', purpose: 'on_account' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('tr', 'Payment — cash').click()
        cy.contains('button', 'Refund…').should('not.exist')
      })
    })
  })
})
